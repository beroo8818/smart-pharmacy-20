CREATE OR REPLACE FUNCTION public.wipe_all_inventory_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'system_admin') THEN
    RAISE EXCEPTION 'permission denied';
  END IF;
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
$$;

REVOKE ALL ON FUNCTION public.wipe_all_inventory_data() FROM public;
GRANT EXECUTE ON FUNCTION public.wipe_all_inventory_data() TO authenticated;