
CREATE TABLE IF NOT EXISTS public.active_ingredient_dictionary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_item_name text NOT NULL,
  scientific_name text,
  trade_name text,
  active_ingredient text,
  strength text,
  dosage_form text,
  unit text,
  standard_name text,
  therapeutic_group_key text,
  confidence_score numeric NOT NULL DEFAULT 0,
  needs_review boolean NOT NULL DEFAULT true,
  approved boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS aid_original_name_uniq
  ON public.active_ingredient_dictionary (lower(original_item_name));
CREATE INDEX IF NOT EXISTS aid_tgk_idx
  ON public.active_ingredient_dictionary (therapeutic_group_key);
CREATE INDEX IF NOT EXISTS aid_needs_review_idx
  ON public.active_ingredient_dictionary (needs_review);

ALTER TABLE public.active_ingredient_dictionary ENABLE ROW LEVEL SECURITY;

CREATE POLICY aid_read ON public.active_ingredient_dictionary
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY aid_insert ON public.active_ingredient_dictionary
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::app_role)
  );

CREATE POLICY aid_update ON public.active_ingredient_dictionary
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::app_role)
  );

CREATE POLICY aid_delete ON public.active_ingredient_dictionary
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
  );

CREATE TRIGGER aid_touch_updated_at
BEFORE UPDATE ON public.active_ingredient_dictionary
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
