
-- Status enum for recommendation actions
DO $$ BEGIN
  CREATE TYPE public.recommendation_status AS ENUM ('new','approved','rejected','postponed','executed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.recommendation_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id uuid NOT NULL,
  recommendation_key text NOT NULL,
  recommendation_type text NOT NULL,
  item_key text,
  item_name text,
  from_location text,
  to_location text,
  suggested_qty numeric,
  executed_qty numeric,
  status public.recommendation_status NOT NULL DEFAULT 'new',
  note text,
  acted_by uuid NOT NULL,
  acted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recact_batch ON public.recommendation_actions(upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_recact_key ON public.recommendation_actions(recommendation_key);
CREATE INDEX IF NOT EXISTS idx_recact_acted_by ON public.recommendation_actions(acted_by);

ALTER TABLE public.recommendation_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "recact_read"
ON public.recommendation_actions
FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));

CREATE POLICY "recact_insert"
ON public.recommendation_actions
FOR INSERT TO authenticated
WITH CHECK (acted_by = auth.uid() AND public.is_staff(auth.uid()));

CREATE POLICY "recact_update_own_or_admin"
ON public.recommendation_actions
FOR UPDATE TO authenticated
USING (
  acted_by = auth.uid()
  OR public.has_role(auth.uid(), 'system_admin')
  OR public.has_role(auth.uid(), 'pharmacy_manager')
)
WITH CHECK (
  acted_by = auth.uid()
  OR public.has_role(auth.uid(), 'system_admin')
  OR public.has_role(auth.uid(), 'pharmacy_manager')
);

CREATE POLICY "recact_delete_admin"
ON public.recommendation_actions
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'system_admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_recact_updated_at ON public.recommendation_actions;
CREATE TRIGGER trg_recact_updated_at
BEFORE UPDATE ON public.recommendation_actions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
