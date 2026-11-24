-- ============================================================
-- Admin Panel, Email Backfill & Security Hardening
-- ============================================================

-- 1. Lock down profiles RLS so users can never tamper with is_banned or is_admin
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

-- 2. Add is_admin and email columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email text;

-- 3. Keep profiles.email synced automatically on new signups
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- 4. Backfill existing emails from auth.users
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- 5. Grant admin privileges to both of the owner's active Google accounts
UPDATE public.profiles
SET is_admin = true,
    is_banned = false,
    ban_reason = NULL,
    report_count = 0
WHERE id IN (
  'da1ddbc6-bf38-4a71-b241-efb44a62ddc9',
  'ec21dd83-b96c-452d-a710-20a117e3aedd'
);

-- 6. Prevent auto-ban from locking out admin accounts
CREATE OR REPLACE FUNCTION submit_report(
  p_reported_id uuid,
  p_room_id     text,
  p_chat_log    jsonb,
  p_reason      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_count integer;
BEGIN
  IF auth.uid() = p_reported_id THEN
    RAISE EXCEPTION 'You cannot report yourself';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.reports
    WHERE reporter_id = auth.uid() AND room_id = p_room_id
  ) THEN
    RAISE EXCEPTION 'You have already reported this session';
  END IF;

  INSERT INTO public.reports (reporter_id, reported_id, room_id, chat_log, reason)
  VALUES (auth.uid(), p_reported_id, p_room_id, p_chat_log, p_reason);

  UPDATE public.profiles
  SET report_count = report_count + 1
  WHERE id = p_reported_id
  RETURNING report_count INTO current_count;

  IF current_count >= 5 THEN
    UPDATE public.profiles
    SET is_banned  = true,
        ban_reason = 'Auto-banned: too many reports from other users'
    WHERE id = p_reported_id AND is_admin = false;
  END IF;
END;
$$;

-- 7. Admin RPC: List all reports (with emails & target ban state)
CREATE OR REPLACE FUNCTION admin_list_reports()
RETURNS TABLE(
  id uuid,
  reporter_id uuid,
  reporter_email text,
  reported_id uuid,
  reported_email text,
  reported_is_banned boolean,
  reported_report_count integer,
  room_id text,
  chat_log jsonb,
  reason text,
  status text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.reporter_id,
    rep_from.email AS reporter_email,
    r.reported_id,
    rep_to.email AS reported_email,
    COALESCE(rep_to.is_banned, false) AS reported_is_banned,
    COALESCE(rep_to.report_count, 0) AS reported_report_count,
    r.room_id,
    r.chat_log,
    r.reason,
    r.status,
    r.created_at
  FROM public.reports r
  LEFT JOIN public.profiles rep_from ON rep_from.id = r.reporter_id
  LEFT JOIN public.profiles rep_to   ON rep_to.id = r.reported_id
  ORDER BY r.created_at DESC
  LIMIT 200;
END;
$$;

-- 8. Admin RPC: List all user profiles
CREATE OR REPLACE FUNCTION admin_list_profiles()
RETURNS TABLE(
  id uuid,
  email text,
  is_banned boolean,
  ban_reason text,
  report_count integer,
  is_admin boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: Admin access required';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    COALESCE(p.is_banned, false) AS is_banned,
    p.ban_reason,
    COALESCE(p.report_count, 0) AS report_count,
    COALESCE(p.is_admin, false) AS is_admin,
    p.created_at
  FROM public.profiles p
  ORDER BY p.is_admin DESC, p.is_banned DESC, p.created_at DESC
  LIMIT 300;
END;
$$;

-- 9. Admin RPC: Ban or unban a user cleanly
CREATE OR REPLACE FUNCTION admin_set_ban(
  target_user_id uuid,
  ban_status boolean,
  reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: Admin access required';
  END IF;

  IF ban_status = true AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = target_user_id AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Cannot ban an admin account';
  END IF;

  IF ban_status = true THEN
    UPDATE public.profiles
    SET is_banned = true,
        ban_reason = COALESCE(NULLIF(trim(reason), ''), 'Suspended by moderator')
    WHERE id = target_user_id;

    DELETE FROM public.queue WHERE user_id = target_user_id;
  ELSE
    UPDATE public.profiles
    SET is_banned = false,
        ban_reason = NULL,
        report_count = 0
    WHERE id = target_user_id;
  END IF;
END;
$$;

-- 10. Admin RPC: Update a report's status ('pending', 'reviewed', 'dismissed')
CREATE OR REPLACE FUNCTION admin_update_report_status(
  target_report_id uuid,
  new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.is_admin = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: Admin access required';
  END IF;

  IF new_status NOT IN ('pending', 'reviewed', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid status';
  END IF;

  UPDATE public.reports
  SET status = new_status
  WHERE id = target_report_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_reports() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_list_profiles() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_set_ban(uuid, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION admin_update_report_status(uuid, text) TO authenticated, service_role;
