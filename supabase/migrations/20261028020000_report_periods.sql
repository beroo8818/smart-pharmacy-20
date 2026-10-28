BEGIN;
ALTER TABLE public.upload_batches ADD COLUMN IF NOT EXISTS issued_from date, ADD COLUMN IF NOT EXISTS issued_to date,
 ADD COLUMN IF NOT EXISTS received_from date, ADD COLUMN IF NOT EXISTS received_to date;
ALTER TABLE public.branch_reports ADD COLUMN IF NOT EXISTS issued_from date, ADD COLUMN IF NOT EXISTS issued_to date,
 ADD COLUMN IF NOT EXISTS received_from date, ADD COLUMN IF NOT EXISTS received_to date;
ALTER TABLE public.branch_reports ADD COLUMN IF NOT EXISTS consumption_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.upload_batches ADD COLUMN IF NOT EXISTS snapshot_boundary text CHECK(snapshot_boundary IN ('start_of_day','end_of_day'));
ALTER TABLE public.branch_reports ADD COLUMN IF NOT EXISTS snapshot_boundary text CHECK(snapshot_boundary IN ('start_of_day','end_of_day'));
ALTER TABLE public.inventory_movements ADD COLUMN IF NOT EXISTS received_quantity numeric;
ALTER TABLE public.upload_batches ADD CONSTRAINT report_period_pairs CHECK (
 (issued_from IS NULL AND issued_to IS NULL OR issued_from IS NOT NULL AND issued_to IS NOT NULL AND issued_from<=issued_to) AND
 (received_from IS NULL AND received_to IS NULL OR received_from IS NOT NULL AND received_to IS NOT NULL AND received_from<=received_to));

CREATE FUNCTION public.report_dates(m date,s date,k text,p jsonb) RETURNS jsonb
 LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE f date; t date; prefix text; result jsonb:='{"issued_from":null,"issued_to":null,"received_from":null,"received_to":null}'; today date:=(now() AT TIME ZONE 'Africa/Cairo')::date;
BEGIN
 IF m IS NULL OR extract(day FROM m)<>1 OR m>date_trunc('month',today)::date OR s IS NULL OR s>today THEN RAISE EXCEPTION 'شهر التقرير أو تاريخ الرصيد غير صالح'; END IF;
 IF k<>'period_consumption' AND p->>'snapshot_boundary' IS NOT NULL THEN
  IF p->>'snapshot_boundary' NOT IN ('start_of_day','end_of_day') THEN RAISE EXCEPTION 'حدد الرصيد في بداية اليوم أو نهايته'; END IF;
  result:=result||jsonb_build_object('snapshot_boundary',p->>'snapshot_boundary');
 END IF;
 FOREACH prefix IN ARRAY ARRAY['issued','received'] LOOP
  IF prefix='issued' AND k NOT IN ('monthly','period_consumption') THEN CONTINUE; END IF;
  f:=nullif(p->>(prefix||'_from'),'')::date; t:=nullif(p->>(prefix||'_to'),'')::date;
  IF f IS NULL AND t IS NULL THEN
   IF prefix='issued' AND m>=date_trunc('month',today)::date THEN RAISE EXCEPTION 'حدد المنصرف من يوم إلى يوم للشهر الحالي'; END IF;
   CONTINUE;
  END IF;
  IF f IS NULL OR t IS NULL OR f>t OR t>today OR date_trunc('month',f)::date<>m OR date_trunc('month',t)::date<>m THEN RAISE EXCEPTION 'فترة المنصرف أو الوارد غير صالحة؛ داخل الشهر المختار وحتى اليوم'; END IF;
  result:=result||jsonb_build_object(prefix||'_from',f,prefix||'_to',t);
 END LOOP;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.report_dates(date,date,text,jsonb) FROM PUBLIC,anon,authenticated;

-- Keep legacy administrative actions and their restrictions; never expose the old write entry point.
ALTER FUNCTION public.hospital_operations(text,jsonb) RENAME TO hospital_operations_v1;
REVOKE ALL ON FUNCTION public.hospital_operations_v1(text,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.hospital_operations(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 u uuid:=auth.uid(); manage boolean:=hospital_manager(); branch uuid:=user_location(auth.uid());
 loc public.locations%ROWTYPE; report public.branch_reports%ROWTYPE;
 v_month date; v_snapshot date; v_kind text; v_dates jsonb; v_rows jsonb; r jsonb;
 v_hash text; v_id uuid; v_batch uuid; v_result jsonb; v_from date; v_to date;
 v_status text:=p_payload->>'status'; v_note text:=trim(coalesce(p_payload->>'note',''));
BEGIN
 IF u IS NULL OR NOT is_staff(u) THEN RAISE EXCEPTION 'الحساب غير مفعل'; END IF;
 IF p_action NOT IN ('save_import','submit','review') THEN RETURN hospital_operations_v1(p_action,p_payload); END IF;
 IF p_action IN ('save_import','submit') THEN
  v_month:=(p_payload->>'month')::date; v_snapshot:=(p_payload->>'snapshot_date')::date; v_kind:=p_payload->>'kind';
  IF v_kind='period_consumption' AND v_snapshot IS NULL THEN v_snapshot:=(p_payload->>'issued_to')::date; END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('monthly','partial_update','weekly_update','full_snapshot','period_consumption') THEN RAISE EXCEPTION 'نوع التقرير غير صالح'; END IF;
  v_dates:=report_dates(v_month,v_snapshot,v_kind,p_payload);
 END IF;
 IF p_action='save_import' THEN
  IF NOT(manage OR has_role(u,'warehouse_keeper')) THEN RAISE EXCEPTION 'رفع الملف المجمع للمسؤول فقط'; END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 50000 THEN RAISE EXCEPTION 'لا توجد صفوف صالحة'; END IF;
  SELECT jsonb_agg(jsonb_build_object('item_code',nullif(trim(e->>'item_code'),''),'item_name',nullif(trim(e->>'item_name'),''),'scientific_name',nullif(trim(e->>'scientific_name'),''),'trade_name',nullif(trim(e->>'trade_name'),''),'unit',nullif(trim(e->>'unit'),''),'location_name',trim(e->>'location_name'),'location_type',e->>'location_type',
   'issued_quantity',CASE WHEN v_kind IN ('monthly','period_consumption') THEN e->'issued_quantity' ELSE 'null'::jsonb END,
   'current_balance',CASE WHEN v_kind='period_consumption' THEN 'null'::jsonb ELSE e->'current_balance' END,
   'received_quantity',e->'received_quantity') ORDER BY e->>'location_name',e->>'item_code',e->>'item_name',e->>'unit')
   INTO v_rows FROM jsonb_array_elements(p_payload->'rows') e;
  FOR r IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
   IF nullif(r->>'location_name','') IS NULL OR r->>'location_type' IS NULL OR r->>'location_type' NOT IN ('sub_pharmacy','main_warehouse') THEN RAISE EXCEPTION 'الموقع غير صالح'; END IF;
   IF nullif(r->>'item_code','') IS NULL AND nullif(r->>'item_name','') IS NULL THEN RAISE EXCEPTION 'الصنف غير معرف'; END IF;
   IF (r->>'issued_quantity')::numeric<0 OR (r->>'current_balance')::numeric<0 OR (r->>'received_quantity')::numeric<0
    OR coalesce(r->>'issued_quantity','') IN ('NaN','Infinity','-Infinity') OR coalesce(r->>'current_balance','') IN ('NaN','Infinity','-Infinity') OR coalesce(r->>'received_quantity','') IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'كمية غير صالحة'; END IF;
   IF coalesce((r->>'received_quantity')::numeric,0)<>0 AND v_dates->>'received_from' IS NULL THEN RAISE EXCEPTION 'حدد فترة الوارد قبل حفظ كمياته'; END IF;
  END LOOP;
  v_hash:=md5(jsonb_build_array(v_month,v_snapshot,v_kind,v_dates,v_rows)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_month::text,0));
  SELECT id INTO v_batch FROM upload_batches WHERE content_hash=v_hash;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'batchId',v_batch); END IF;
  IF v_kind IN ('monthly','period_consumption') THEN
   v_from:=coalesce((v_dates->>'issued_from')::date,v_month);
   v_to:=coalesce((v_dates->>'issued_to')::date,(v_month+interval '1 month - 1 day')::date);
   IF EXISTS(
    SELECT 1 FROM inventory_movements m JOIN upload_batches b ON b.id=m.upload_batch_id CROSS JOIN jsonb_array_elements(v_rows) e
    WHERE b.status='saved' AND b.month=v_month AND coalesce(b.batch_kind,'monthly') IN ('monthly','period_consumption')
     AND m.issued_quantity IS NOT NULL AND e->>'issued_quantity' IS NOT NULL
     AND m.location_name=e->>'location_name' AND m.location_type=e->>'location_type'
     AND coalesce(m.item_code,m.item_name)=coalesce(e->>'item_code',e->>'item_name') AND coalesce(m.unit,'')=coalesce(e->>'unit','')
     AND coalesce(b.issued_from,b.month)<=v_to AND coalesce(b.issued_to,(b.month+interval '1 month - 1 day')::date)>=v_from
     AND NOT(coalesce(b.issued_from,b.month)<=v_from AND coalesce(b.issued_to,(b.month+interval '1 month - 1 day')::date)>=v_to)
     AND NOT(coalesce(b.issued_from,b.month)>=v_from AND coalesce(b.issued_to,(b.month+interval '1 month - 1 day')::date)<=v_to)
   ) THEN RAISE EXCEPTION 'تداخل جزئي في فترة المنصرف؛ ارفع فترة مستقلة بلا تداخل أو تقريرًا تراكميًا يغطي الفترة السابقة بالكامل'; END IF;
  END IF;
  IF NOT coalesce((p_payload->>'confirm_revision')::boolean,false) AND EXISTS(
   SELECT 1 FROM inventory_movements m JOIN upload_batches b ON b.id=m.upload_batch_id CROSS JOIN jsonb_array_elements(v_rows) e
   WHERE b.status='saved' AND b.month=v_month AND m.location_name=e->>'location_name' AND m.location_type=e->>'location_type'
    AND coalesce(m.item_code,m.item_name)=coalesce(e->>'item_code',e->>'item_name') AND coalesce(m.unit,'')=coalesce(e->>'unit','')
    AND ((v_kind<>'period_consumption' AND coalesce(b.batch_kind,'monthly')<>'period_consumption' AND b.snapshot_date=v_snapshot)
     OR (v_from IS NOT NULL AND coalesce(b.batch_kind,'monthly') IN ('monthly','period_consumption') AND coalesce(b.issued_from,b.month)<=v_to AND coalesce(b.issued_to,(b.month+interval '1 month - 1 day')::date)>=v_from))
  ) THEN RETURN jsonb_build_object('ok',false,'requiresRevision',true,'error','توجد فترة مغطاة أو رصيد لنفس التاريخ؛ راجع التصحيح. الفترة التراكمية الأوسع لا تجمع مع الفترة التي تغطيها.'); END IF;
  INSERT INTO upload_batches(file_name,month,status,created_by,snapshot_date,batch_kind,rows_saved,content_hash,created_at,issued_from,issued_to,received_from,received_to,snapshot_boundary)
   VALUES(coalesce(p_payload->>'file_name','تقرير'),v_month,'saved',u,v_snapshot,v_kind,jsonb_array_length(v_rows),v_hash,clock_timestamp(),(v_dates->>'issued_from')::date,(v_dates->>'issued_to')::date,(v_dates->>'received_from')::date,(v_dates->>'received_to')::date,v_dates->>'snapshot_boundary') RETURNING id INTO v_batch;
  INSERT INTO inventory_movements(upload_batch_id,month,item_code,item_name,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance,received_quantity,created_by)
   SELECT v_batch,v_month,e->>'item_code',e->>'item_name',e->>'scientific_name',e->>'trade_name',e->>'unit',e->>'location_name',e->>'location_type',(e->>'issued_quantity')::numeric,(e->>'current_balance')::numeric,(e->>'received_quantity')::numeric,u FROM jsonb_array_elements(v_rows) e;
  v_id:=v_batch;
 ELSIF p_action='submit' THEN
  SELECT * INTO loc FROM locations WHERE id=(p_payload->>'location_id')::uuid AND type='sub_pharmacy' AND active;
  IF NOT FOUND OR NOT coalesce(manage OR (hospital_branch_user() AND loc.id=branch),false) THEN RAISE EXCEPTION 'الصيدلية غير مسموحة'; END IF;
  IF v_kind NOT IN ('monthly','partial_update','period_consumption') OR jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'بيانات التقرير غير صالحة'; END IF;
  SELECT jsonb_agg(jsonb_build_object('item_code',trim(e->>'item_code'),'item_name',trim(e->>'item_name'),'unit',trim(e->>'unit'),'balance',e->'balance','issued',e->'issued') ORDER BY trim(e->>'item_code')) INTO v_rows FROM jsonb_array_elements(p_payload->'rows') e;
  IF (SELECT count(DISTINCT e->>'item_code') FROM jsonb_array_elements(v_rows) e)<>jsonb_array_length(v_rows) THEN RAISE EXCEPTION 'لا تكرر كود الصنف'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
   IF NOT EXISTS(SELECT 1 FROM inventory_movements WHERE item_code=r->>'item_code' AND unit=r->>'unit') OR nullif(r->>'item_name','') IS NULL THEN RAISE EXCEPTION 'اختر صنفًا معروفًا بنفس الوحدة'; END IF;
   IF (v_kind<>'period_consumption' AND (jsonb_typeof(r->'balance') IS DISTINCT FROM 'number' OR (r->>'balance')::numeric<0))
    OR (v_kind='period_consumption' AND coalesce(jsonb_typeof(r->'balance'),'null')<>'null')
    OR (v_kind<>'partial_update' AND (jsonb_typeof(r->'issued') IS DISTINCT FROM 'number' OR (r->>'issued')::numeric<0))
    OR (v_kind='partial_update' AND coalesce(jsonb_typeof(r->'issued'),'null')<>'null') THEN RAISE EXCEPTION 'الكميات ناقصة أو غير صالحة'; END IF;
  END LOOP;
  v_hash:=md5(jsonb_build_array(loc.id,v_month,v_snapshot,v_kind,v_dates,v_rows)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_hash,0));
  SELECT id INTO v_id FROM branch_reports WHERE fingerprint=v_hash;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'id',v_id); END IF;
  INSERT INTO branch_reports(location_id,month,snapshot_date,kind,entries,fingerprint,created_by,issued_from,issued_to,consumption_only,snapshot_boundary)
   VALUES(loc.id,v_month,v_snapshot,CASE WHEN v_kind='period_consumption' THEN 'monthly' ELSE v_kind END,v_rows,v_hash,u,(v_dates->>'issued_from')::date,(v_dates->>'issued_to')::date,v_kind='period_consumption',v_dates->>'snapshot_boundary') RETURNING id INTO v_id;
 ELSIF p_action='review' THEN
  IF NOT manage THEN RAISE EXCEPTION 'الاعتماد للمدير فقط'; END IF;
  SELECT * INTO report FROM branch_reports WHERE id=(p_payload->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR report.status<>'pending' OR v_status IS NULL OR v_status NOT IN ('approved','rejected') OR length(v_note)<5 THEN RAISE EXCEPTION 'قرار غير صالح أو التقرير غير معلق'; END IF;
  IF v_status='approved' THEN
   SELECT * INTO loc FROM locations WHERE id=report.location_id AND active;
   IF NOT FOUND THEN RAISE EXCEPTION 'الصيدلية غير فعالة'; END IF;
   SELECT jsonb_agg(jsonb_build_object('item_code',e->>'item_code','item_name',i.item_name,'scientific_name',i.scientific_name,'trade_name',i.trade_name,'unit',e->>'unit','location_name',loc.name,'location_type','sub_pharmacy','current_balance',e->'balance','issued_quantity',e->'issued')) INTO v_rows
    FROM jsonb_array_elements(report.entries) e CROSS JOIN LATERAL(SELECT item_name,scientific_name,trade_name FROM inventory_movements WHERE item_code=e->>'item_code' AND unit=e->>'unit' ORDER BY created_at DESC LIMIT 1)i;
   IF jsonb_array_length(v_rows) IS DISTINCT FROM jsonb_array_length(report.entries) THEN RAISE EXCEPTION 'أصناف التقرير تغيرت'; END IF;
   v_result:=hospital_operations('save_import',jsonb_build_object('file_name','تقرير '||loc.name,'month',report.month,'snapshot_date',report.snapshot_date,'snapshot_boundary',report.snapshot_boundary,'kind',CASE WHEN report.consumption_only THEN 'period_consumption' ELSE report.kind END,'issued_from',report.issued_from,'issued_to',report.issued_to,'rows',v_rows,'confirm_revision',true));
   v_batch:=(v_result->>'batchId')::uuid;
  END IF;
  UPDATE branch_reports SET status=v_status,note=v_note,reviewed_by=u,reviewed_at=now(),batch_id=v_batch WHERE id=report.id;
  v_id:=report.id;
 END IF;
 INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_value) VALUES(u,p_action,'hospital_operations',v_id::text,jsonb_build_object('status',v_status,'note',v_note,'dates',v_dates,'batch_id',v_batch));
 RETURN jsonb_build_object('ok',true,'id',v_id,'batchId',v_batch);
END; $$;
REVOKE ALL ON FUNCTION public.hospital_operations(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hospital_operations(text,jsonb) TO authenticated;
COMMIT;
