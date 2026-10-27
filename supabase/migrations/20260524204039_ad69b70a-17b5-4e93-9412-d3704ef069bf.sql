ALTER TABLE public.item_master
ADD COLUMN IF NOT EXISTS first_active_date date;

COMMENT ON COLUMN public.item_master.first_active_date IS
'Optional: date the item was first introduced/used. If set, ADC uses (today - first_active_date) as denominator instead of 30.';