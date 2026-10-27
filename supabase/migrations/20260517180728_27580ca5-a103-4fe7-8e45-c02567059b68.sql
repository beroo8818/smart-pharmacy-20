
-- Storage bucket for uploaded Excel/CSV files
INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "uploads_read_staff" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'uploads' AND public.is_staff(auth.uid()));

CREATE POLICY "uploads_insert_staff" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'uploads' AND public.is_staff(auth.uid()));

CREATE POLICY "uploads_delete_admin" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'uploads' AND public.has_role(auth.uid(), 'system_admin'));

-- Add storage_path to uploads table to link the file
ALTER TABLE public.uploads ADD COLUMN IF NOT EXISTS storage_path text;
