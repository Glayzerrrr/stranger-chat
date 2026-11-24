-- ============================================================
-- Anti-Ghost Matchmaking & Queue Heartbeat
-- ============================================================

-- 1. Heartbeat function to keep active searcher's queue entry fresh
CREATE OR REPLACE FUNCTION queue_heartbeat(searching_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() = searching_user_id THEN
    UPDATE public.queue
    SET created_at = now()
    WHERE user_id = searching_user_id AND room_id IS NULL;
  END IF;
END;
$$;

-- 2. Update find_match to aggressively purge ghosts and only match active users
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

  -- 1. PURGE GHOSTS: Delete any queue entries older than 25 seconds (stale/abandoned tabs)
  DELETE FROM public.queue
  WHERE created_at < now() - interval '25 seconds';

  -- 2. Try to grab an active waiting user (within last 25 seconds, not self, not banned)
  SELECT q.id, q.user_id INTO partner
  FROM public.queue q
  JOIN public.profiles p ON p.id = q.user_id
  WHERE q.user_id != searching_user_id
    AND q.room_id IS NULL
    AND p.is_banned = false
    AND q.created_at >= now() - interval '25 seconds'
  ORDER BY q.created_at ASC
  LIMIT 1
  FOR UPDATE OF q SKIP LOCKED;

  IF NOT FOUND THEN
    -- Nobody actively waiting — add self to queue with fresh timestamp
    INSERT INTO public.queue (user_id, created_at)
    VALUES (searching_user_id, now())
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

  -- Remove self from queue
  DELETE FROM public.queue WHERE user_id = searching_user_id;

  matched_room_id   := new_room_id;
  matched_partner_id := partner.user_id;
  RETURN NEXT;
END;
$$;

-- 3. Also grant permissions to ensure anon and authenticated can execute queue_heartbeat
GRANT EXECUTE ON FUNCTION queue_heartbeat(uuid) TO anon, authenticated, service_role;
