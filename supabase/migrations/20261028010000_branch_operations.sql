BEGIN;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.hospital_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT has_role(auth.uid(), 'system_admin') OR has_role(auth.uid(), 'pharmacy_manager');
$$;
CREATE OR REPLACE FUNCTION public.hospital_branch_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT has_role(auth.uid(), 'sub_pharmacist') AND NOT (hospital_manager() OR has_role(auth.uid(), 'warehouse_keeper'));
$$;
CREATE OR REPLACE FUNCTION public.hospital_location_allowed(n text, t text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT is_staff(auth.uid()) AND (NOT hospital_branch_user() OR (t = 'sub_pharmacy' AND n = user_location_name(auth.uid())));
$$;

-- Restrictive policies also constrain older permissive policies and mixed viewer roles.
CREATE POLICY hospital_branch_inventory ON public.inventory_movements AS RESTRICTIVE FOR ALL TO authenticated
 USING (hospital_location_allowed(location_name, location_type)) WITH CHECK (NOT hospital_branch_user());
CREATE POLICY hospital_branch_batches ON public.upload_batches AS RESTRICTIVE FOR SELECT TO authenticated
 USING (NOT hospital_branch_user() OR EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.upload_batch_id = upload_batches.id AND m.location_name = user_location_name(auth.uid()) AND m.location_type = 'sub_pharmacy'));
CREATE POLICY hospital_branch_batches_write ON public.upload_batches AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT hospital_branch_user());
CREATE POLICY hospital_branch_batches_update ON public.upload_batches AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT hospital_branch_user()) WITH CHECK (NOT hospital_branch_user());
CREATE POLICY hospital_branch_stock ON public.stock_transactions AS RESTRICTIVE FOR ALL TO authenticated
 USING (NOT hospital_branch_user() OR from_location_name = user_location_name(auth.uid()) OR to_location_name = user_location_name(auth.uid()))
 WITH CHECK (NOT hospital_branch_user());
CREATE POLICY hospital_branch_stock_delete ON public.stock_transactions AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT hospital_branch_user());
CREATE POLICY hospital_branch_monthly ON public.monthly_stock_movements AS RESTRICTIVE FOR ALL TO authenticated
 USING (NOT hospital_branch_user() OR location_id = user_location(auth.uid())) WITH CHECK (NOT hospital_branch_user());
CREATE POLICY hospital_branch_locations ON public.locations AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT hospital_branch_user() OR id = user_location(auth.uid()));
CREATE POLICY hospital_branch_forecasts ON public.forecasts AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT hospital_branch_user() OR location_id = user_location(auth.uid()));
CREATE POLICY hospital_branch_alerts ON public.alerts AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT hospital_branch_user() OR location_id = user_location(auth.uid()));
CREATE POLICY hospital_branch_transfers ON public.transfers AS RESTRICTIVE FOR ALL TO authenticated
 USING (NOT hospital_branch_user() OR from_location_id = user_location(auth.uid()) OR to_location_id = user_location(auth.uid())) WITH CHECK (NOT hospital_branch_user());
CREATE POLICY hospital_branch_recommendations ON public.recommendation_actions AS RESTRICTIVE FOR ALL TO authenticated
 USING (NOT hospital_branch_user() OR from_location = user_location_name(auth.uid()) OR to_location = user_location_name(auth.uid())) WITH CHECK (NOT hospital_branch_user());
CREATE POLICY hospital_branch_quality ON public.data_quality_issues AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT hospital_branch_user());
CREATE POLICY hospital_branch_ignored ON public.import_ignored_rows AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT hospital_branch_user());
CREATE POLICY hospital_branch_source_files ON public.uploads AS RESTRICTIVE FOR SELECT TO authenticated USING (NOT hospital_branch_user());
CREATE POLICY hospital_branch_original_files ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated USING (bucket_id <> 'uploads' OR NOT public.hospital_branch_user());
CREATE POLICY hospital_branch_inventory_delete ON public.inventory_movements AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT hospital_branch_user());
CREATE POLICY hospital_branch_monthly_delete ON public.monthly_stock_movements AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT hospital_branch_user());
CREATE POLICY hospital_branch_recommendations_delete ON public.recommendation_actions AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT hospital_branch_user());

CREATE OR REPLACE FUNCTION public.guard_profile_branch() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 IF (CASE WHEN TG_OP='INSERT' THEN NEW.assigned_location_id IS NOT NULL ELSE NEW.assigned_location_id IS DISTINCT FROM OLD.assigned_location_id END) AND auth.uid() IS NOT NULL AND NOT hospital_manager() THEN
  RAISE EXCEPTION 'تعيين الصيدلية للمدير فقط';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_profile_branch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_branch();
CREATE TRIGGER guard_profile_branch_insert BEFORE INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.guard_profile_branch();

CREATE TABLE public.branch_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id uuid NOT NULL REFERENCES public.locations(id),
 month date NOT NULL, snapshot_date date NOT NULL, kind text NOT NULL CHECK(kind IN ('monthly','partial_update')),
 entries jsonb NOT NULL, fingerprint text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 note text, created_by uuid NOT NULL REFERENCES auth.users(id), reviewed_by uuid REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, batch_id uuid REFERENCES public.upload_batches(id)
);
CREATE TABLE public.branch_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), location_id uuid NOT NULL REFERENCES public.locations(id),
 item_code text NOT NULL, item_name text NOT NULL, unit text NOT NULL, qty numeric NOT NULL CHECK(qty > 0),
 status text NOT NULL DEFAULT 'requested' CHECK(status IN ('requested','approved','preparing','received','rejected')),
 note text NOT NULL, created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.branch_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.branch_reports, public.branch_requests FROM anon, authenticated;
GRANT SELECT ON public.branch_reports, public.branch_requests TO authenticated;
CREATE POLICY branch_reports_read ON public.branch_reports FOR SELECT TO authenticated USING (hospital_manager() OR (hospital_branch_user() AND location_id = user_location(auth.uid())));
CREATE POLICY branch_requests_read ON public.branch_requests FOR SELECT TO authenticated USING (hospital_manager() OR has_role(auth.uid(), 'warehouse_keeper') OR (hospital_branch_user() AND location_id = user_location(auth.uid())));
ALTER TABLE public.upload_batches ADD COLUMN IF NOT EXISTS content_hash text;
CREATE UNIQUE INDEX hospital_import_fingerprint ON public.upload_batches(content_hash) WHERE content_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION public.hospital_operations(p_action text, p_payload jsonb DEFAULT '{}') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
 u uuid := auth.uid(); manage boolean := hospital_manager(); branch uuid := user_location(auth.uid());
 loc public.locations%ROWTYPE; report public.branch_reports%ROWTYPE; request public.branch_requests%ROWTYPE;
 v_id uuid; v_batch uuid; v_hash text; v_rows jsonb; r jsonb; v_month date; v_snapshot date; v_kind text;
 v_result jsonb; v_status text := p_payload->>'status'; v_note text := trim(coalesce(p_payload->>'note',''));
BEGIN
 IF u IS NULL OR NOT is_staff(u) THEN RAISE EXCEPTION 'الحساب غير مفعل؛ اطلب من المدير تعيين الصيدلية'; END IF;
 IF p_action = 'overview' THEN
  RETURN jsonb_build_object('ok',true,'manager',manage,'location_id',CASE WHEN hospital_branch_user() THEN branch END,
   'locations', coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type) ORDER BY name) FROM public.locations WHERE active AND (manage OR has_role(u,'warehouse_keeper') OR id = branch)), '[]'),
   'users', CASE WHEN manage THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'email',p.email,'assigned_location_id',p.assigned_location_id,'roles',coalesce((SELECT jsonb_agg(ur.role) FROM public.user_roles ur WHERE ur.user_id=p.id),'[]'))) FROM public.profiles p), '[]') ELSE '[]'::jsonb END,
   'catalog', coalesce((SELECT jsonb_agg(x) FROM (SELECT DISTINCT item_code, item_name, unit FROM public.inventory_movements WHERE nullif(item_code,'') IS NOT NULL AND nullif(unit,'') IS NOT NULL ORDER BY item_name) x), '[]'),
   'reports', coalesce((SELECT jsonb_agg(to_jsonb(x)-'entries'||jsonb_build_object('rows',x.entries) ORDER BY x.created_at DESC) FROM (SELECT * FROM public.branch_reports WHERE manage OR (hospital_branch_user() AND location_id=branch) ORDER BY created_at DESC LIMIT 2000) x), '[]'),
   'transfers', coalesce((SELECT jsonb_agg(x ORDER BY x.created_at DESC) FROM (SELECT * FROM public.branch_requests WHERE manage OR has_role(u,'warehouse_keeper') OR (hospital_branch_user() AND location_id=branch) ORDER BY created_at DESC LIMIT 2000) x), '[]'));
 END IF;
 IF p_action = 'location_create' THEN
  IF NOT manage THEN RAISE EXCEPTION 'للمدير فقط'; END IF;
  IF nullif(trim(p_payload->>'name'),'') IS NULL OR EXISTS(SELECT 1 FROM locations WHERE name=trim(p_payload->>'name')) THEN RAISE EXCEPTION 'الاسم فارغ أو موجود بالفعل'; END IF;
  INSERT INTO locations(name,type) VALUES(trim(p_payload->>'name'),'sub_pharmacy') RETURNING id INTO v_id;
 ELSIF p_action IN ('assign','revoke') THEN
  IF NOT manage THEN RAISE EXCEPTION 'للمدير فقط'; END IF;
  v_id := (p_payload->>'user_id')::uuid;
  PERFORM 1 FROM profiles WHERE id=v_id FOR UPDATE;
  IF v_id=u OR NOT FOUND OR EXISTS(SELECT 1 FROM user_roles WHERE user_id=v_id AND role NOT IN ('viewer','sub_pharmacist')) THEN RAISE EXCEPTION 'لا يمكن تعديل صلاحيات المديرين أو أمناء المخزن من هنا'; END IF;
  IF p_action='assign' THEN
   SELECT * INTO loc FROM locations WHERE id=(p_payload->>'location_id')::uuid AND type='sub_pharmacy' AND active;
   IF NOT FOUND THEN RAISE EXCEPTION 'الصيدلية غير صالحة'; END IF;
  END IF;
  DELETE FROM user_roles WHERE user_id=v_id;
  UPDATE profiles SET assigned_location_id=loc.id WHERE id=v_id;
  IF p_action='assign' THEN INSERT INTO user_roles(user_id,role) VALUES(v_id,'sub_pharmacist'); END IF;
 ELSIF p_action='save_import' THEN
  IF NOT(manage OR has_role(u,'warehouse_keeper')) THEN RAISE EXCEPTION 'رفع الملف المجمع للمسؤول فقط'; END IF;
  v_month := (p_payload->>'month')::date; v_snapshot := (p_payload->>'snapshot_date')::date; v_kind := p_payload->>'kind';
  IF v_snapshot IS NULL OR v_snapshot>(now() AT TIME ZONE 'Africa/Cairo')::date OR v_month IS NULL OR extract(day FROM v_month)<>1 OR v_kind NOT IN ('monthly','partial_update','weekly_update','full_snapshot','period_consumption') OR v_kind IS NULL THEN RAISE EXCEPTION 'الفترة أو تاريخ الرصيد أو نوع التحديث غير صالح'; END IF;
  IF v_kind IN ('monthly','period_consumption') AND v_month >= date_trunc('month',(now() AT TIME ZONE 'Africa/Cairo'))::date THEN RAISE EXCEPTION 'المنصرف الشهري يخص شهرًا مكتملًا'; END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 50000 THEN RAISE EXCEPTION 'لا توجد صفوف صالحة'; END IF;
  SELECT jsonb_agg(jsonb_build_object('item_code',nullif(trim(e->>'item_code'),''),'item_name',nullif(trim(e->>'item_name'),''),'scientific_name',nullif(trim(e->>'scientific_name'),''),'trade_name',nullif(trim(e->>'trade_name'),''),'unit',nullif(trim(e->>'unit'),''),'location_name',trim(e->>'location_name'),'location_type',e->>'location_type','issued_quantity',CASE WHEN v_kind IN ('monthly','period_consumption') THEN e->'issued_quantity' ELSE 'null'::jsonb END,'current_balance',CASE WHEN v_kind='period_consumption' THEN 'null'::jsonb ELSE e->'current_balance' END) ORDER BY e->>'location_name',e->>'item_code',e->>'item_name',e->>'unit') INTO v_rows FROM jsonb_array_elements(p_payload->'rows') e;
  FOR r IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
   IF nullif(r->>'location_name','') IS NULL OR r->>'location_type' NOT IN ('sub_pharmacy','main_warehouse') THEN RAISE EXCEPTION 'الموقع غير صالح'; END IF;
   IF (r->>'issued_quantity')::numeric<0 OR (r->>'current_balance')::numeric<0 OR coalesce(r->>'issued_quantity','') IN ('NaN','Infinity','-Infinity') OR coalesce(r->>'current_balance','') IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'كمية غير صالحة'; END IF;
   IF nullif(r->>'item_code','') IS NULL AND nullif(r->>'item_name','') IS NULL THEN RAISE EXCEPTION 'الصنف غير معرف'; END IF;
  END LOOP;
  v_hash := md5(jsonb_build_array(v_month,v_snapshot,v_kind,v_rows)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_month::text||v_kind,0));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_hash,0));
  SELECT id INTO v_batch FROM upload_batches WHERE content_hash=v_hash;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'batchId',v_batch); END IF;
  IF NOT coalesce((p_payload->>'confirm_revision')::boolean,false) AND EXISTS (
   SELECT 1 FROM inventory_movements m JOIN upload_batches b ON b.id=m.upload_batch_id CROSS JOIN jsonb_array_elements(v_rows) e
   WHERE b.status='saved' AND b.month=v_month AND b.batch_kind=v_kind AND (v_kind='monthly' OR b.snapshot_date=v_snapshot)
   AND m.location_name=e->>'location_name' AND coalesce(m.item_code,m.item_name)=coalesce(e->>'item_code',e->>'item_name') AND coalesce(m.unit,'')=coalesce(e->>'unit','')
  ) THEN RETURN jsonb_build_object('ok',false,'requiresRevision',true,'error','توجد بيانات لنفس الفترة. هل راجعت التصحيح؟ لن تجمع الأرصدة أو يكرر المنصرف.'); END IF;
  INSERT INTO upload_batches(file_name,month,status,created_by,snapshot_date,batch_kind,rows_saved,content_hash,created_at)
   VALUES(coalesce(p_payload->>'file_name','تقرير صيدلية'),v_month,'saved',u,v_snapshot,v_kind,jsonb_array_length(v_rows),v_hash,clock_timestamp()) RETURNING id INTO v_batch;
  INSERT INTO inventory_movements(upload_batch_id,month,item_code,item_name,scientific_name,trade_name,unit,location_name,location_type,issued_quantity,current_balance,created_by)
   SELECT v_batch,v_month,e->>'item_code',e->>'item_name',e->>'scientific_name',e->>'trade_name',e->>'unit',e->>'location_name',e->>'location_type',(e->>'issued_quantity')::numeric,(e->>'current_balance')::numeric,u FROM jsonb_array_elements(v_rows) e;
  v_id:=v_batch;
 ELSIF p_action='submit' THEN
  SELECT * INTO loc FROM locations WHERE id=(p_payload->>'location_id')::uuid AND type='sub_pharmacy' AND active;
  IF NOT FOUND OR NOT coalesce(manage OR (hospital_branch_user() AND loc.id=branch),false) THEN RAISE EXCEPTION 'الصيدلية غير مسموحة'; END IF;
  v_month:=(p_payload->>'month')::date; v_snapshot:=(p_payload->>'snapshot_date')::date; v_kind:=p_payload->>'kind';
  IF v_month IS NULL OR v_snapshot IS NULL OR v_snapshot>(now() AT TIME ZONE 'Africa/Cairo')::date OR extract(day FROM v_month)<>1 OR v_month>=date_trunc('month',v_snapshot)::date OR v_kind NOT IN ('monthly','partial_update') OR v_kind IS NULL THEN RAISE EXCEPTION 'شهر المنصرف يجب أن يكون سابقًا مكتملًا وتاريخ الرصيد غير مستقبلي'; END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 5000 THEN RAISE EXCEPTION 'أضف أصناف التقرير'; END IF;
  SELECT jsonb_agg(jsonb_build_object('item_code',trim(e->>'item_code'),'item_name',trim(e->>'item_name'),'unit',trim(e->>'unit'),'balance',e->'balance','issued',e->'issued') ORDER BY trim(e->>'item_code')) INTO v_rows FROM jsonb_array_elements(p_payload->'rows') e;
  IF (SELECT count(DISTINCT e->>'item_code') FROM jsonb_array_elements(v_rows) e) <> jsonb_array_length(v_rows) THEN RAISE EXCEPTION 'لا تكرر كود الصنف'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
   IF NOT EXISTS(SELECT 1 FROM inventory_movements WHERE item_code=r->>'item_code' AND unit=r->>'unit') OR nullif(r->>'item_name','') IS NULL THEN RAISE EXCEPTION 'اختر صنفًا معروفًا بنفس الوحدة'; END IF;
   IF jsonb_typeof(r->'balance') IS DISTINCT FROM 'number' OR (r->>'balance')::numeric<0 OR (v_kind='monthly' AND (jsonb_typeof(r->'issued') IS DISTINCT FROM 'number' OR (r->>'issued')::numeric<0)) OR (v_kind='partial_update' AND coalesce(jsonb_typeof(r->'issued'),'null')<>'null') THEN RAISE EXCEPTION 'الكميات ناقصة أو غير صالحة'; END IF;
  END LOOP;
  v_hash:=md5(jsonb_build_array(loc.id,v_month,v_snapshot,v_kind,v_rows)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_hash,0));
  SELECT id INTO v_id FROM branch_reports WHERE fingerprint=v_hash;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'id',v_id); END IF;
  INSERT INTO branch_reports(location_id,month,snapshot_date,kind,entries,fingerprint,created_by) VALUES(loc.id,v_month,v_snapshot,v_kind,v_rows,v_hash,u) RETURNING id INTO v_id;
 ELSIF p_action='review' THEN
  IF NOT manage THEN RAISE EXCEPTION 'الاعتماد للمدير فقط'; END IF;
  SELECT * INTO report FROM branch_reports WHERE id=(p_payload->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR report.status<>'pending' OR v_status NOT IN ('approved','rejected') OR v_status IS NULL OR length(v_note)<5 THEN RAISE EXCEPTION 'قرار غير صالح أو التقرير غير معلق أو السبب ناقص'; END IF;
  IF v_status='approved' THEN
   SELECT * INTO loc FROM locations WHERE id=report.location_id AND active;
   IF NOT FOUND THEN RAISE EXCEPTION 'الصيدلية غير فعالة'; END IF;
   SELECT jsonb_agg(jsonb_build_object('item_code',e->>'item_code','item_name',i.item_name,'scientific_name',i.scientific_name,'trade_name',i.trade_name,'unit',e->>'unit','location_name',loc.name,'location_type','sub_pharmacy','current_balance',e->'balance','issued_quantity',e->'issued')) INTO v_rows
    FROM jsonb_array_elements(report.entries) e CROSS JOIN LATERAL (SELECT item_name,scientific_name,trade_name FROM inventory_movements WHERE item_code=e->>'item_code' AND unit=e->>'unit' ORDER BY created_at DESC LIMIT 1) i;
   IF jsonb_array_length(v_rows) IS DISTINCT FROM jsonb_array_length(report.entries) THEN RAISE EXCEPTION 'أصناف التقرير تغيرت؛ راجعها'; END IF;
   v_result:=hospital_operations('save_import',jsonb_build_object('file_name','تقرير '||loc.name,'month',report.month,'snapshot_date',report.snapshot_date,'kind',report.kind,'rows',v_rows,'confirm_revision',true));
   v_batch:=(v_result->>'batchId')::uuid;
  END IF;
  UPDATE branch_reports SET status=v_status,note=v_note,reviewed_by=u,reviewed_at=now(),batch_id=v_batch WHERE id=report.id;
  v_id:=report.id;
 ELSIF p_action='request' THEN
  SELECT * INTO loc FROM locations WHERE id=(p_payload->>'location_id')::uuid AND type='sub_pharmacy' AND active;
  IF NOT FOUND OR NOT coalesce(manage OR (hospital_branch_user() AND loc.id=branch),false) THEN RAISE EXCEPTION 'الصيدلية غير مسموحة'; END IF;
  IF coalesce((p_payload->>'qty')::numeric,0)<=0 OR length(v_note)<5 OR nullif(p_payload->>'item_code','') IS NULL OR nullif(p_payload->>'unit','') IS NULL OR (p_payload->>'qty') IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'الكمية والوحدة والصنف والسبب مطلوبة'; END IF;
  INSERT INTO branch_requests(location_id,item_code,item_name,unit,qty,note,created_by) VALUES(loc.id,p_payload->>'item_code',p_payload->>'item_name',p_payload->>'unit',(p_payload->>'qty')::numeric,v_note,u) RETURNING id INTO v_id;
 ELSIF p_action='request_status' THEN
  SELECT * INTO request FROM branch_requests WHERE id=(p_payload->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR length(v_note)<5 OR v_status IS NULL THEN RAISE EXCEPTION 'الطلب أو المستند غير صالح'; END IF;
  IF NOT coalesce(manage OR (has_role(u,'warehouse_keeper') AND v_status='preparing') OR (hospital_branch_user() AND request.location_id=branch AND v_status='received'),false) THEN RAISE EXCEPTION 'تغيير حالة غير مسموح'; END IF;
  IF NOT((request.status='requested' AND v_status IN ('approved','rejected')) OR (request.status='approved' AND v_status IN ('preparing','rejected')) OR (request.status='preparing' AND v_status='received')) THEN RAISE EXCEPTION 'ترتيب الحالات غير صحيح'; END IF;
  UPDATE branch_requests SET status=v_status,note=note||E'\n'||v_note WHERE id=request.id;
  v_id:=request.id;
 ELSE RAISE EXCEPTION 'إجراء غير معروف';
 END IF;
 INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_value) VALUES(u,p_action,'hospital_operations',v_id::text,jsonb_build_object('status',v_status,'note',v_note,'location_id',p_payload->'location_id','user_id',p_payload->'user_id','name',p_payload->'name','kind',v_kind,'month',v_month,'snapshot_date',v_snapshot,'batch_id',v_batch));
 RETURN jsonb_build_object('ok',true,'id',v_id,'batchId',v_batch);
END; $$;
REVOKE ALL ON FUNCTION public.hospital_operations(text,jsonb), public.hospital_manager(), public.hospital_branch_user(), public.hospital_location_allowed(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hospital_operations(text,jsonb), public.hospital_manager(), public.hospital_branch_user(), public.hospital_location_allowed(text,text) TO authenticated;
COMMIT;
