-- Chat-Nachrichten müssen über Realtime an alle offenen Chat-Oberflächen
-- ausgeliefert werden. Der Block ist idempotent und kann bei jedem Deploy laufen.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
END
$$;