ALTER TABLE public.inventory_movements
  ADD COLUMN IF NOT EXISTS batch_no text,
  ADD COLUMN IF NOT EXISTS expiry_date date;