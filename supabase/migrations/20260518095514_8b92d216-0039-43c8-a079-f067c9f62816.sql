CREATE TABLE IF NOT EXISTS public.upload_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  month date NOT NULL,
  rows_saved integer NOT NULL DEFAULT 0,
  rows_ignored integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'saved',
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_batch_id uuid NOT NULL REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  month date NOT NULL,
  item_name text,
  item_code text,
  scientific_name text,
  trade_name text,
  unit text,
  location_name text NOT NULL,
  location_type text NOT NULL,
  issued_quantity numeric NOT NULL DEFAULT 0,
  current_balance numeric NOT NULL DEFAULT 0,
  source_sheet text,
  source_row_number integer,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upload_batches_created_at ON public.upload_batches (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upload_batches_created_by ON public.upload_batches (created_by);
CREATE INDEX IF NOT EXISTS idx_upload_batches_month ON public.upload_batches (month);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_batch ON public.inventory_movements (upload_batch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_month ON public.inventory_movements (month);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item ON public.inventory_movements (item_code, item_name);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_location ON public.inventory_movements (location_name, location_type);

ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS upload_batches_read ON public.upload_batches;
DROP POLICY IF EXISTS upload_batches_insert ON public.upload_batches;
DROP POLICY IF EXISTS upload_batches_update ON public.upload_batches;
DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
DROP POLICY IF EXISTS inventory_movements_insert ON public.inventory_movements;

CREATE POLICY upload_batches_read
ON public.upload_batches
FOR SELECT
TO authenticated
USING (public.is_staff(auth.uid()));

CREATE POLICY upload_batches_insert
ON public.upload_batches
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::app_role)
    OR public.has_role(auth.uid(), 'sub_pharmacist'::app_role)
  )
);

CREATE POLICY upload_batches_update
ON public.upload_batches
FOR UPDATE
TO authenticated
USING (
  created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::app_role)
    OR public.has_role(auth.uid(), 'sub_pharmacist'::app_role)
  )
)
WITH CHECK (
  created_by = auth.uid()
  AND (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::app_role)
    OR public.has_role(auth.uid(), 'sub_pharmacist'::app_role)
  )
);

CREATE POLICY inventory_movements_read
ON public.inventory_movements
FOR SELECT
TO authenticated
USING (public.is_staff(auth.uid()));

CREATE POLICY inventory_movements_insert
ON public.inventory_movements
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.upload_batches b
    WHERE b.id = upload_batch_id
      AND b.created_by = auth.uid()
  )
  AND (
    public.has_role(auth.uid(), 'system_admin'::app_role)
    OR public.has_role(auth.uid(), 'pharmacy_manager'::app_role)
    OR public.has_role(auth.uid(), 'warehouse_keeper'::app_role)
    OR public.has_role(auth.uid(), 'sub_pharmacist'::app_role)
  )
);