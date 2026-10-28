BEGIN;
ALTER TABLE public.stock_transactions ADD COLUMN IF NOT EXISTS issued_from date;
ALTER TABLE public.stock_transactions ADD COLUMN IF NOT EXISTS issued_to date;
CREATE OR REPLACE FUNCTION public.guard_actual_issue_period() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.qty IS NULL OR NEW.qty<=0 OR NEW.qty::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'كمية غير صالحة'; END IF;
 IF NEW.txn_date IS NULL OR NEW.txn_date>(now() AT TIME ZONE 'Africa/Cairo')::date THEN RAISE EXCEPTION 'تاريخ الحركة غير صالح أو في المستقبل'; END IF;
 IF NEW.issued_from IS NOT NULL OR NEW.issued_to IS NOT NULL THEN
  IF NEW.txn_type<>'pharmacy_issue' OR NEW.issued_from IS NULL OR NEW.issued_to IS NULL OR NEW.issued_from>NEW.issued_to OR NEW.issued_to>NEW.txn_date THEN RAISE EXCEPTION 'فترة المنصرف الفعلي غير صالحة'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(coalesce(NEW.item_code,NEW.item_key)||'|'||coalesce(NEW.unit,'')||'|'||coalesce(NEW.from_location_name,''),0));
  IF EXISTS(SELECT 1 FROM stock_transactions s WHERE s.id IS DISTINCT FROM NEW.id AND s.txn_type='pharmacy_issue' AND coalesce(s.item_code,s.item_key)=coalesce(NEW.item_code,NEW.item_key) AND coalesce(s.unit,'')=coalesce(NEW.unit,'') AND s.from_location_name=NEW.from_location_name AND s.issued_from<=NEW.issued_to AND s.issued_to>=NEW.issued_from) THEN RAISE EXCEPTION 'فترة منصرف فعلي متداخلة؛ لا تسجل نفس الأيام مرتين'; END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER actual_issue_period BEFORE INSERT OR UPDATE ON public.stock_transactions FOR EACH ROW EXECUTE FUNCTION public.guard_actual_issue_period();
CREATE OR REPLACE FUNCTION public.hospital_reporting_freshness() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT is_staff(auth.uid()) THEN RAISE EXCEPTION 'غير مسجل الدخول'; END IF;
 SELECT coalesce(jsonb_agg(x ORDER BY x.name),'[]') INTO result FROM(
  SELECT l.id,l.name,l.type,
   max(b.snapshot_date) FILTER(WHERE b.batch_kind<>'period_consumption' AND m.current_balance IS NOT NULL) last_balance,
   max(b.snapshot_date) FILTER(WHERE b.batch_kind IN ('monthly','full_snapshot') AND m.current_balance IS NOT NULL) last_full_balance,
   max(b.snapshot_date) FILTER(WHERE b.batch_kind IN ('partial_update','weekly_update') AND m.current_balance IS NOT NULL) last_partial_balance,
   max(coalesce(b.issued_to,(b.month+interval '1 month - 1 day')::date)) FILTER(WHERE b.batch_kind IN ('monthly','period_consumption') AND m.issued_quantity IS NOT NULL) last_consumption
  FROM locations l LEFT JOIN inventory_movements m ON m.location_name=l.name AND m.location_type=l.type::text
  LEFT JOIN upload_batches b ON b.id=m.upload_batch_id AND b.status='saved' AND b.snapshot_date<=(now() AT TIME ZONE 'Africa/Cairo')::date
  WHERE l.active AND hospital_location_allowed(l.name,l.type::text) GROUP BY l.id,l.name,l.type
 )x;
 RETURN jsonb_build_object('ok',true,'locations',result,'completeScope',hospital_manager() OR has_role(auth.uid(),'warehouse_keeper'));
END;$$;
REVOKE ALL ON FUNCTION public.hospital_reporting_freshness(),public.guard_actual_issue_period() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hospital_reporting_freshness() TO authenticated;
COMMIT;
