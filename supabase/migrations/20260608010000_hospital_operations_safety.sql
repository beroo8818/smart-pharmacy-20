-- Hospital go-live safety hardening.
-- Keeps existing features, but makes override decisions traceable.

ALTER TABLE public.recommendation_actions
  ADD COLUMN IF NOT EXISTS match_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_unreviewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS therapeutic_group_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'recact_override_reason_required'
  ) THEN
    ALTER TABLE public.recommendation_actions
      ADD CONSTRAINT recact_override_reason_required
      CHECK (
        override_unreviewed = false
        OR length(trim(coalesce(override_reason, ''))) >= 8
      );
  END IF;
END $$;

DROP POLICY IF EXISTS "recact_insert" ON public.recommendation_actions;
CREATE POLICY "recact_insert"
ON public.recommendation_actions
FOR INSERT TO authenticated
WITH CHECK (
  acted_by = auth.uid()
  AND public.is_staff(auth.uid())
  AND (
    override_unreviewed = false
    OR public.has_role(auth.uid(), 'system_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::public.app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::public.app_role)
  )
);

DROP POLICY IF EXISTS "audit_read" ON public.audit_log;
CREATE POLICY "audit_read" ON public.audit_log FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'system_admin'::public.app_role)
    OR public.has_role(auth.uid(),'pharmacy_manager'::public.app_role)
    OR public.has_role(auth.uid(),'viewer'::public.app_role)
  );

CREATE INDEX IF NOT EXISTS idx_recact_override
  ON public.recommendation_actions(override_unreviewed, acted_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_entity
  ON public.audit_log(entity_type, entity_id, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_transactions_note_required'
  ) THEN
    ALTER TABLE public.stock_transactions
      ADD CONSTRAINT stock_transactions_note_required
      CHECK (length(trim(coalesce(note, ''))) >= 5);
  END IF;
END $$;
