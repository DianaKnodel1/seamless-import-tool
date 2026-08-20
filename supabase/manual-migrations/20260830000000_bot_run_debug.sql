-- Diagnose-Daten für fehlgeschlagene Bot-Schritte (Screenshot/HTML/Trace-Pfade + Element-Vorschläge).
ALTER TABLE public.bot_runs
  ADD COLUMN IF NOT EXISTS debug jsonb;
