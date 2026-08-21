-- Chat: echte Systemmeldungs-Markierung + serverseitige Gesprächsliste
-- Manuell auf der Datenbank ausführen (wie die übrigen Dateien in db-migrations/).

-- 1) Echte Markierung statt Raten am Nachrichtentext
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

-- 2) Gesprächsliste über ALLE Nachrichten (kein 5.000-Zeilen-Fenster)
CREATE OR REPLACE FUNCTION public.list_chat_conversations()
RETURNS TABLE (
  partner_id uuid,
  last_message text,
  last_at timestamptz,
  unread bigint,
  last_from_partner_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH admin_ids AS (
    SELECT user_id FROM public.user_roles
    WHERE role::text IN ('admin', 'admin_mitarbeiter')
  ),
  relevant AS (
    SELECT
      CASE WHEN m.sender_id IN (SELECT user_id FROM admin_ids)
           THEN m.receiver_id ELSE m.sender_id END AS partner_id,
      m.sender_id,
      m.message,
      m.read,
      m.created_at
    FROM public.chat_messages m
    WHERE (m.sender_id IN (SELECT user_id FROM admin_ids)
        OR m.receiver_id IN (SELECT user_id FROM admin_ids))
      AND m.message NOT LIKE '🤖 KI-Eskalation%'
      AND m.message NOT LIKE '🤖 KI Eskalation%'
      AND m.message NOT LIKE '[ESCALATE]%'
  ),
  filtered AS (
    SELECT * FROM relevant r
    WHERE r.partner_id IS NOT NULL
      AND r.partner_id NOT IN (SELECT user_id FROM admin_ids)
  )
  SELECT
    f.partner_id,
    (ARRAY_AGG(f.message ORDER BY f.created_at DESC))[1] AS last_message,
    MAX(f.created_at) AS last_at,
    COUNT(*) FILTER (WHERE f.sender_id = f.partner_id AND f.read = false) AS unread,
    MAX(f.created_at) FILTER (WHERE f.sender_id = f.partner_id) AS last_from_partner_at
  FROM filtered f
  GROUP BY f.partner_id;
$$;

REVOKE ALL ON FUNCTION public.list_chat_conversations() FROM public;
GRANT EXECUTE ON FUNCTION public.list_chat_conversations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_chat_conversations() TO service_role;
