
CREATE TABLE public.import_ignored_rows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  upload_batch_id UUID NOT NULL,
  sheet_name TEXT,
  row_number INTEGER,
  reason TEXT NOT NULL,
  preview JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_iir_batch ON public.import_ignored_rows(upload_batch_id);

ALTER TABLE public.import_ignored_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY iir_read ON public.import_ignored_rows
  FOR SELECT TO authenticated
  USING (is_staff(auth.uid()));

CREATE POLICY iir_insert ON public.import_ignored_rows
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.upload_batches b
      WHERE b.id = upload_batch_id AND b.created_by = auth.uid()
    )
  );

CREATE POLICY iir_delete_admin ON public.import_ignored_rows
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'system_admin'::app_role));
