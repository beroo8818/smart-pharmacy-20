-- Add snapshot_date and batch_kind to upload_batches
ALTER TABLE public.upload_batches
  ADD COLUMN IF NOT EXISTS snapshot_date date,
  ADD COLUMN IF NOT EXISTS batch_kind text NOT NULL DEFAULT 'monthly';

-- Backfill snapshot_date for existing rows = last day of month
UPDATE public.upload_batches
SET snapshot_date = (date_trunc('month', month) + interval '1 month - 1 day')::date
WHERE snapshot_date IS NULL;

-- Transaction types
DO $$ BEGIN
  CREATE TYPE public.stock_txn_type AS ENUM (
    'warehouse_receipt',
    'warehouse_issue_to_pharmacy',
    'pharmacy_issue',
    'pharmacy_transfer',
    'warehouse_return',
    'pharmacy_return_to_warehouse'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS public.stock_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL DEFAULT CURRENT_DATE,
  txn_type public.stock_txn_type NOT NULL,
  item_key text NOT NULL,
  item_name text,
  item_code text,
  unit text,
  from_location_name text,
  from_location_type text,
  to_location_name text,
  to_location_type text,
  qty numeric NOT NULL CHECK (qty > 0),
  note text,
  source_batch_id uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stx_date ON public.stock_transactions(txn_date DESC);
CREATE INDEX IF NOT EXISTS idx_stx_item ON public.stock_transactions(item_key);

ALTER TABLE public.stock_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stx_read ON public.stock_transactions;
CREATE POLICY stx_read ON public.stock_transactions
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

DROP POLICY IF EXISTS stx_insert ON public.stock_transactions;
CREATE POLICY stx_insert ON public.stock_transactions
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      public.has_role(auth.uid(), 'system_admin')
      OR public.has_role(auth.uid(), 'pharmacy_manager')
      OR public.has_role(auth.uid(), 'warehouse_keeper')
      OR public.has_role(auth.uid(), 'sub_pharmacist')
    )
  );

DROP POLICY IF EXISTS stx_update ON public.stock_transactions;
CREATE POLICY stx_update ON public.stock_transactions
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'pharmacy_manager')
  )
  WITH CHECK (
    created_by = auth.uid()
    OR public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'pharmacy_manager')
  );

DROP POLICY IF EXISTS stx_delete ON public.stock_transactions;
CREATE POLICY stx_delete ON public.stock_transactions
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'system_admin')
    OR public.has_role(auth.uid(), 'pharmacy_manager')
  );

-- Update wipe function to clear new table too
CREATE OR REPLACE FUNCTION public.wipe_all_inventory_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
  DELETE FROM public.stock_transactions;
  DELETE FROM public.recommendation_actions;
  DELETE FROM public.transfers;
  DELETE FROM public.alerts;
  DELETE FROM public.forecasts;
  DELETE FROM public.data_quality_issues;
  DELETE FROM public.import_ignored_rows;
  DELETE FROM public.monthly_stock_movements;
  DELETE FROM public.inventory_movements;
  DELETE FROM public.item_aliases;
  DELETE FROM public.item_master;
  DELETE FROM public.upload_batches;
  DELETE FROM public.uploads;
  INSERT INTO public.audit_log(user_id, action, entity_type)
  VALUES (auth.uid(), 'wipe_all_data', 'system');
END;
$function$;