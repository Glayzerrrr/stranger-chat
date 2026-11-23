-- ============================================================
-- StrangerChat Database Schema
-- Run this in the Supabase SQL Editor (or as a migration)
-- ============================================================

-- 1. Profiles table (auto-created on signup)
-- ---------------------------------------------------------
CREATE TABLE profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_banned   boolean   DEFAULT false,
  ban_reason  text,
  report_count integer  DEFAULT 0,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();


-- 2. Matchmaking queue
-- ---------------------------------------------------------
CREATE TABLE queue (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id      text,
  matched_with uuid        REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own queue entry"
  ON queue FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own queue entry"
  ON queue FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own queue entry"
  ON queue FOR DELETE
  USING (auth.uid() = user_id);

-- Enable Realtime so the waiting user gets notified of a match
ALTER PUBLICATION supabase_realtime ADD TABLE queue;


-- 3. Reports table
-- ---------------------------------------------------------
CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id     text NOT NULL,
  chat_log    jsonb,
  reason      text,
  status      text DEFAULT 'pending'
                   CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can submit reports"
  ON reports FOR INSERT
  WITH CHECK (auth.uid() = reporter_id);


-- 4. Core RPC: Atomic matchmaking
-- ---------------------------------------------------------
-- Uses FOR UPDATE SKIP LOCKED to prevent two searchers from
-- grabbing the same waiting user (race-condition safe).
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION find_match(searching_user_id uuid)
RETURNS TABLE(matched_room_id text, matched_partner_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  partner RECORD;
  new_room_id text;
BEGIN
  -- Verify caller identity
  IF auth.uid() != searching_user_id THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Block banned users
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = searching_user_id AND is_banned = true
  ) THEN
    RAISE EXCEPTION 'Account is banned';
  END IF;

  -- Try to grab the oldest waiting user (not self, not banned)
  SELECT q.id, q.user_id INTO partner
  FROM public.queue q
  JOIN public.profiles p ON p.id = q.user_id
  WHERE q.user_id != searching_user_id
    AND q.room_id IS NULL
    AND p.is_banned = false
  ORDER BY q.created_at ASC
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;

  IF NOT FOUND THEN
    -- Nobody waiting — add self to queue
    INSERT INTO public.queue (user_id)
    VALUES (searching_user_id)
    ON CONFLICT (user_id)
    DO UPDATE SET
      created_at   = now(),
      room_id      = NULL,
      matched_with = NULL;

    matched_room_id   := NULL;
    matched_partner_id := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Match found — generate a room
  new_room_id := gen_random_uuid()::text;

  -- Tag the partner's queue row (triggers their Realtime subscription)
  UPDATE public.queue
  SET room_id      = new_room_id,
      matched_with = searching_user_id
  WHERE id = partner.id;

  -- Remove self from queue (if a stale entry exists)
  DELETE FROM public.queue WHERE user_id = searching_user_id;

  matched_room_id   := new_room_id;
  matched_partner_id := partner.user_id;
  RETURN NEXT;
END;
$$;


-- 5. Report submission + auto-ban
-- ---------------------------------------------------------
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
  -- Prevent reporting yourself
  IF auth.uid() = p_reported_id THEN
    RAISE EXCEPTION 'You cannot report yourself';
  END IF;

  -- Prevent duplicate reports for the same chat room
  IF EXISTS (
    SELECT 1 FROM public.reports 
    WHERE reporter_id = auth.uid() AND room_id = p_room_id
  ) THEN
    RAISE EXCEPTION 'You have already reported this session';
  END IF;

  -- Insert the report
  INSERT INTO public.reports (reporter_id, reported_id, room_id, chat_log, reason)
  VALUES (auth.uid(), p_reported_id, p_room_id, p_chat_log, p_reason);

  -- Bump the report counter
  UPDATE public.profiles
  SET report_count = report_count + 1
  WHERE id = p_reported_id
  RETURNING report_count INTO current_count;

  -- Auto-ban at 5 unique reports
  IF current_count >= 5 THEN
    UPDATE public.profiles
    SET is_banned  = true,
        ban_reason = 'Auto-banned: too many reports from other users'
    WHERE id = p_reported_id;
  END IF;
END;
$$;


-- 6. Stale queue cleanup (optional — call from a cron / Edge Function)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION cleanup_stale_queue()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.queue
  WHERE room_id IS NULL
    AND created_at < now() - interval '5 minutes';

  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
