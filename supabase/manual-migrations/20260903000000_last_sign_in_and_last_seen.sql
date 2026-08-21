-- Sicherstellen, dass Login-/Aktivitätsanzeige im Admin-Chat funktioniert.
-- Idempotent: kann mehrfach laufen.

-- 1) Aktivitätsspalte für Presence-Heartbeat
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- 2) Letzter Login aus auth.users (nur für Admins lesbar)
CREATE OR REPLACE FUNCTION public.get_last_sign_ins(_user_ids uuid[])
RETURNS TABLE (user_id uuid, last_sign_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY SELECT u.id, u.last_sign_in_at FROM auth.users u WHERE u.id = ANY(_user_ids);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_last_sign_ins(uuid[]) TO authenticated;
