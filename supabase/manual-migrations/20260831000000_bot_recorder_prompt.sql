-- Aufnahme-Modus (Recorder im Browser des Admins) + Rückfragen/Fortsetzen für Bot-Läufe.

-- ------------------------------------------------------------ Bot-Läufe
ALTER TABLE public.bot_runs
  ADD COLUMN IF NOT EXISTS run_vars jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pending_var text,
  ADD COLUMN IF NOT EXISTS pending_prompt text,
  ADD COLUMN IF NOT EXISTS resume_step integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS storage_state jsonb;

-- ------------------------------------------------------------ Aufnahmen
CREATE TABLE IF NOT EXISTS public.bot_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  profile_id uuid REFERENCES public.bot_profiles(id) ON DELETE SET NULL,
  name text NOT NULL,
  start_url text,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'recording',
  raw_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  cleaned_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '2 hours'
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.bot_recordings TO authenticated;
GRANT ALL ON public.bot_recordings TO service_role;

ALTER TABLE public.bot_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins verwalten Aufnahmen" ON public.bot_recordings;
CREATE POLICY "Admins verwalten Aufnahmen"
  ON public.bot_recordings FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS bot_recordings_created_at_idx
  ON public.bot_recordings (created_at DESC);
