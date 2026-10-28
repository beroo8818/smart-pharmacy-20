BEGIN;
CREATE TABLE public.user_access_profiles(user_id uuid PRIMARY KEY REFERENCES profiles(id),permissions text[] NOT NULL DEFAULT '{}',location_ids uuid[] NOT NULL DEFAULT '{}',all_branches boolean NOT NULL DEFAULT false,updated_by uuid REFERENCES profiles(id),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.permission_catalog(key text PRIMARY KEY,groups jsonb NOT NULL,sensitive boolean NOT NULL DEFAULT false);
INSERT INTO permission_catalog(key,groups,sensitive) VALUES ('screen.home','["read","branch"]'::jsonb,false),
('screen.dashboard','["read"]'::jsonb,false),
('screen.my-pharmacy','["read","branch"]'::jsonb,false),
('screen.branch-access','["manager"]'::jsonb,false),
('screen.permissions','["manager"]'::jsonb,false),
('screen.report-center','["read","branch"]'::jsonb,false),
('screen.data-freshness','["read","branch"]'::jsonb,false),
('screen.workflows','["read","branch"]'::jsonb,false),
('screen.daily','["read"]'::jsonb,false),
('screen.upload','["staff"]'::jsonb,false),
('screen.google-sync','["manager"]'::jsonb,false),
('screen.data-sources','["staff"]'::jsonb,false),
('screen.dictionary','["staff"]'::jsonb,false),
('screen.active-ingredients','["staff"]'::jsonb,false),
('screen.items','["read"]'::jsonb,false),
('screen.consumption','["read"]'::jsonb,false),
('screen.alerts','["read"]'::jsonb,false),
('screen.transfers','["staff"]'::jsonb,false),
('screen.stock-transactions','["staff"]'::jsonb,false),
('screen.what-to-do','["read"]'::jsonb,false),
('screen.actions-log','["read"]'::jsonb,false),
('screen.reports','["read"]'::jsonb,false),
('screen.data-review','["staff"]'::jsonb,false),
('screen.backup','["admin"]'::jsonb,true),
('screen.assistant','["read"]'::jsonb,false),
('screen.help','["read","branch"]'::jsonb,false),
('screen.settings','["admin"]'::jsonb,true),
('data.branches','["read","branch"]'::jsonb,false),
('data.warehouse','["read"]'::jsonb,false),
('data.hospital','["read"]'::jsonb,false),
('data.upload','["staff","branch"]'::jsonb,false),
('data.correct','["staff","branch"]'::jsonb,false),
('stock.receipt','["staff"]'::jsonb,false),
('stock.issue','["staff"]'::jsonb,false),
('stock.transfer','["staff"]'::jsonb,false),
('stock.return','["staff"]'::jsonb,false),
('stock.delete','["manager"]'::jsonb,false),
('report.export','["read","branch"]'::jsonb,false),
('report.print','["read","branch"]'::jsonb,false),
('dictionary.write','["staff"]'::jsonb,false),
('requests.create','["staff","branch"]'::jsonb,false),
('requests.prepare','["staff"]'::jsonb,false),
('requests.receive','["staff","branch"]'::jsonb,false),
('users.manage','["manager"]'::jsonb,true),
('permissions.manage','["manager"]'::jsonb,true),
('settings.write','["admin"]'::jsonb,true),
('backup.export','["admin"]'::jsonb,true),
('backup.restore','["admin"]'::jsonb,true),
('data.delete','["admin"]'::jsonb,true);
REVOKE ALL ON public.user_access_profiles,public.permission_catalog FROM PUBLIC,anon,authenticated;
ALTER TABLE public.user_access_profiles ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.hospital_access() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=auth.uid(); p public.user_access_profiles%ROWTYPE; g jsonb; keys jsonb;
BEGIN
 IF u IS NULL OR NOT is_staff(u) THEN RETURN jsonb_build_object('configured',true,'permissions','[]'::jsonb,'location_ids','[]'::jsonb,'all_branches',false); END IF;
 SELECT * INTO p FROM user_access_profiles WHERE user_id=u;
 IF FOUND AND NOT has_role(u,'system_admin') THEN RETURN jsonb_build_object('configured',true,'permissions',to_jsonb(p.permissions),'location_ids',to_jsonb(p.location_ids),'all_branches',p.all_branches); END IF;
 g:=CASE WHEN has_role(u,'system_admin') THEN '["read","branch","staff","manager","admin"]' WHEN has_role(u,'pharmacy_manager') THEN '["read","branch","staff","manager"]' WHEN has_role(u,'warehouse_keeper') THEN '["read","branch","staff"]' WHEN has_role(u,'sub_pharmacist') THEN '["branch"]' WHEN has_role(u,'viewer') THEN '["read"]' ELSE '[]' END;
 SELECT coalesce(jsonb_agg(key),'[]') INTO keys FROM permission_catalog WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(groups) x WHERE g ? x);
 RETURN jsonb_build_object('configured',false,'permissions',keys,'location_ids',CASE WHEN user_location(u) IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(user_location(u)) END,'all_branches',NOT(has_role(u,'sub_pharmacist') AND NOT(has_role(u,'system_admin') OR has_role(u,'pharmacy_manager') OR has_role(u,'warehouse_keeper'))));
END;$$;
CREATE OR REPLACE FUNCTION public.hospital_has_permission(k text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT auth.uid() IS NOT NULL AND (has_role(auth.uid(),'system_admin') OR (hospital_access()->'permissions') ? k); $$;
CREATE OR REPLACE FUNCTION public.hospital_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT hospital_has_permission('users.manage'); $$;
CREATE OR REPLACE FUNCTION public.hospital_branch_user() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT NOT(coalesce((hospital_access()->>'all_branches')::boolean,false) AND hospital_has_permission('data.branches') AND hospital_has_permission('data.warehouse')); $$;
CREATE OR REPLACE FUNCTION public.hospital_location_allowed(n text,t text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT is_staff(auth.uid()) AND (has_role(auth.uid(),'system_admin') OR CASE WHEN t IN ('main_store','main_warehouse') THEN hospital_has_permission('data.warehouse') ELSE t='sub_pharmacy' AND hospital_has_permission('data.branches') AND EXISTS(SELECT 1 FROM locations l WHERE l.name=n AND l.type='sub_pharmacy' AND l.active AND (coalesce((hospital_access()->>'all_branches')::boolean,false) OR (hospital_access()->'location_ids') ? l.id::text)) END);
$$;
CREATE OR REPLACE FUNCTION public.hospital_location_id_allowed(i uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT EXISTS(SELECT 1 FROM locations l WHERE l.id=i AND hospital_location_allowed(l.name,l.type::text)); $$;
CREATE OR REPLACE FUNCTION public.hospital_access_dispatch(a text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE u uuid:=auth.uid(); own jsonb:=hospital_access(); target uuid; target_role text; keys text[]; ids uuid[]; k text; i uuid; loc locations%ROWTYPE; result jsonb; v uuid;
BEGIN
 IF u IS NULL OR NOT is_staff(u) THEN RAISE EXCEPTION 'الحساب غير مفعل'; END IF;
 IF a='access_self' THEN RETURN jsonb_build_object('ok',true,'access',own); END IF;
 IF a IN ('access_overview','access_save') THEN
  IF NOT hospital_has_permission('permissions.manage') THEN RAISE EXCEPTION 'إدارة الصلاحيات غير مسموحة'; END IF;
  IF a='access_overview' THEN
   RETURN jsonb_build_object('ok',true,'actor_id',u,'actor_role',CASE WHEN has_role(u,'system_admin') THEN 'system_admin' ELSE 'pharmacy_manager' END,'access',own,
    'users',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'name',coalesce(nullif(pr.name,''),pr.email,pr.id::text),'role',CASE WHEN has_role(pr.id,'system_admin') THEN 'system_admin' WHEN has_role(pr.id,'pharmacy_manager') THEN 'pharmacy_manager' WHEN has_role(pr.id,'warehouse_keeper') THEN 'warehouse_keeper' WHEN has_role(pr.id,'sub_pharmacist') THEN 'sub_pharmacist' ELSE 'viewer' END,
    'access',coalesce((SELECT jsonb_build_object('configured',true,'permissions',to_jsonb(ap.permissions),'location_ids',to_jsonb(ap.location_ids),'all_branches',ap.all_branches) FROM user_access_profiles ap WHERE ap.user_id=pr.id),jsonb_build_object('configured',false,'permissions',(SELECT coalesce(jsonb_agg(c.key),'[]') FROM permission_catalog c WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(c.groups) g WHERE (CASE WHEN has_role(pr.id,'system_admin') THEN '["read","branch","staff","manager","admin"]'::jsonb WHEN has_role(pr.id,'pharmacy_manager') THEN '["read","branch","staff","manager"]'::jsonb WHEN has_role(pr.id,'warehouse_keeper') THEN '["read","branch","staff"]'::jsonb WHEN has_role(pr.id,'sub_pharmacist') THEN '["branch"]'::jsonb ELSE '["read"]'::jsonb END) ? g)),'location_ids',CASE WHEN pr.assigned_location_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(pr.assigned_location_id) END,'all_branches',NOT has_role(pr.id,'sub_pharmacist'))))) FROM profiles pr),'[]'),
    'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name)) FROM locations WHERE active AND type='sub_pharmacy' AND hospital_location_allowed(name,type::text)),'[]'));
  END IF;
  target:=(p->>'user_id')::uuid;
  IF target=u OR NOT EXISTS(SELECT 1 FROM profiles WHERE id=target) OR has_role(target,'system_admin') OR (has_role(target,'pharmacy_manager') AND NOT has_role(u,'system_admin')) THEN RAISE EXCEPTION 'حساب محمي أو حسابك الحالي'; END IF;
  IF jsonb_typeof(p->'permissions') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'location_ids') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'all_branches') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'بيانات الصلاحيات غير صالحة'; END IF;
  SELECT coalesce(array_agg(DISTINCT value),'{}') INTO keys FROM jsonb_array_elements_text(p->'permissions');
  SELECT coalesce(array_agg(DISTINCT value::uuid),'{}') INTO ids FROM jsonb_array_elements_text(p->'location_ids');
  FOREACH k IN ARRAY keys LOOP
   IF NOT EXISTS(SELECT 1 FROM permission_catalog WHERE key=k) OR NOT hospital_has_permission(k) OR (NOT has_role(u,'system_admin') AND EXISTS(SELECT 1 FROM permission_catalog WHERE key=k AND sensitive)) THEN RAISE EXCEPTION 'لا تمنح صلاحية أعلى من صلاحيتك؛ البنود الحساسة لمدير النظام'; END IF;
  END LOOP;
  IF (p->>'all_branches')::boolean AND NOT coalesce((own->>'all_branches')::boolean,false) THEN RAISE EXCEPTION 'نطاق الصيدليات أوسع من نطاقك'; END IF;
  FOREACH i IN ARRAY ids LOOP IF NOT EXISTS(SELECT 1 FROM locations WHERE id=i AND type='sub_pharmacy' AND active AND hospital_location_id_allowed(i)) THEN RAISE EXCEPTION 'صيدلية غير مسموحة'; END IF; END LOOP;
  INSERT INTO user_access_profiles(user_id,permissions,location_ids,all_branches,updated_by) VALUES(target,keys,ids,(p->>'all_branches')::boolean,u)
   ON CONFLICT(user_id) DO UPDATE SET permissions=excluded.permissions,location_ids=excluded.location_ids,all_branches=excluded.all_branches,updated_by=u,updated_at=now();
  INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_value) VALUES(u,'permissions_changed','profiles',target::text,p-'user_id');
  RETURN jsonb_build_object('ok',true);
 END IF;
 IF a='overview' THEN
  RETURN jsonb_build_object('ok',true,'manager',hospital_manager(),'access',own,'location_id',user_location(u),
   'locations',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'name',name,'type',type)) FROM locations WHERE active AND hospital_location_allowed(name,type::text)),'[]'),
   'users',CASE WHEN hospital_manager() THEN coalesce((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.name,'email',pr.email,'assigned_location_id',pr.assigned_location_id,'roles',(SELECT coalesce(jsonb_agg(role),'[]') FROM user_roles WHERE user_id=pr.id))) FROM profiles pr),'[]') ELSE '[]'::jsonb END,
   'catalog',coalesce((SELECT jsonb_agg(x) FROM(SELECT DISTINCT item_code,item_name,unit FROM inventory_movements WHERE item_code IS NOT NULL AND unit IS NOT NULL AND hospital_location_allowed(location_name,location_type))x),'[]'),
   'reports',coalesce((SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('rows',x.entries)) FROM(SELECT * FROM branch_reports WHERE hospital_location_id_allowed(location_id) ORDER BY created_at DESC LIMIT 2000)x),'[]'),
   'transfers',coalesce((SELECT jsonb_agg(x) FROM(SELECT * FROM branch_requests WHERE hospital_location_id_allowed(location_id) ORDER BY created_at DESC LIMIT 2000)x),'[]'));
 END IF;
 IF a='request' THEN
  IF NOT hospital_has_permission('requests.create') OR NOT hospital_location_id_allowed((p->>'location_id')::uuid) OR jsonb_typeof(p->'qty') IS DISTINCT FROM 'number' OR coalesce((p->>'qty')::numeric,0)<=0 OR length(trim(coalesce(p->>'note','')))<5 THEN RAISE EXCEPTION 'طلب غير صالح أو خارج الصلاحية'; END IF;
  INSERT INTO branch_requests(location_id,item_code,item_name,unit,qty,note,created_by) VALUES((p->>'location_id')::uuid,p->>'item_code',p->>'item_name',p->>'unit',(p->>'qty')::numeric,p->>'note',u) RETURNING id INTO v;
  RETURN jsonb_build_object('ok',true,'id',v);
 END IF;
 IF a IN ('assign','revoke','location_create') THEN
  IF NOT hospital_has_permission('users.manage') THEN RAISE EXCEPTION 'إدارة المستخدمين غير مسموحة'; END IF;
  IF a='assign' AND NOT hospital_location_id_allowed((p->>'location_id')::uuid) THEN RAISE EXCEPTION 'الصيدلية خارج نطاقك'; END IF;
  IF a='location_create' AND NOT coalesce((own->>'all_branches')::boolean,false) THEN RAISE EXCEPTION 'إضافة صيدلية تحتاج نطاق كل الصيدليات'; END IF;
  result:=hospital_operations_v1(a,p);
  IF a IN ('assign','revoke') THEN
   SELECT coalesce(array_agg(key),'{}') INTO keys FROM permission_catalog WHERE groups ? 'branch';
   INSERT INTO user_access_profiles(user_id,permissions,location_ids,all_branches,updated_by) VALUES((p->>'user_id')::uuid,CASE WHEN a='revoke' THEN '{}'::text[] ELSE keys END,CASE WHEN a='assign' THEN ARRAY[(p->>'location_id')::uuid] ELSE '{}'::uuid[] END,false,u)
   ON CONFLICT(user_id) DO UPDATE SET permissions=CASE WHEN a='revoke' THEN '{}'::text[] ELSE user_access_profiles.permissions END,location_ids=excluded.location_ids,all_branches=false,updated_by=u,updated_at=now();
  END IF;
  RETURN result;
 END IF;
 RAISE EXCEPTION 'إجراء غير معروف';
END;$$;
CREATE OR REPLACE FUNCTION public.seed_basic_access() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO user_access_profiles(user_id,permissions,location_ids) SELECT NEW.id,coalesce(array_agg(key),'{}'),CASE WHEN NEW.assigned_location_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[NEW.assigned_location_id] END FROM permission_catalog WHERE groups ? 'branch' ON CONFLICT DO NOTHING;
 RETURN NEW;
END;$$;
CREATE TRIGGER seed_basic_access AFTER INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION public.seed_basic_access();

CREATE OR REPLACE FUNCTION public.hospital_operations(p_action text,p_payload jsonb DEFAULT '{}') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 u uuid:=auth.uid(); manage boolean:=hospital_manager(); branch uuid:=user_location(auth.uid());
 loc public.locations%ROWTYPE; report public.branch_reports%ROWTYPE; request public.branch_requests%ROWTYPE;
 v_month date; v_snapshot date; v_kind text; v_dates jsonb; v_rows jsonb; r jsonb;
 v_hash text; v_id uuid; v_batch uuid; v_result jsonb; v_from date; v_to date;
 v_status text:=p_payload->>'status'; v_note text:=trim(coalesce(p_payload->>'note',''));
BEGIN
 IF u IS NULL OR NOT is_staff(u) THEN RAISE EXCEPTION 'الحساب غير مفعل'; END IF;
 IF p_action='review' THEN RAISE EXCEPTION 'مرحلة الاعتماد ألغيت؛ احفظ التقرير مباشرة'; END IF;
 IF p_action='request_status' THEN
  SELECT * INTO request FROM branch_requests WHERE id=(p_payload->>'id')::uuid FOR UPDATE;
  IF NOT FOUND OR length(v_note)<5 OR v_status IS NULL THEN RAISE EXCEPTION 'الطلب أو المستند غير صالح'; END IF;
  IF NOT hospital_location_id_allowed(request.location_id) OR NOT hospital_has_permission(CASE WHEN v_status='received' THEN 'requests.receive' ELSE 'requests.prepare' END) THEN RAISE EXCEPTION 'تغيير حالة غير مسموح'; END IF;
  IF NOT((request.status IN ('requested','approved') AND v_status IN ('preparing','rejected')) OR (request.status='preparing' AND v_status='received')) THEN RAISE EXCEPTION 'ترتيب الحالات غير صحيح'; END IF;
  UPDATE branch_requests SET status=v_status,note=note||E'\n'||v_note WHERE id=request.id;
  INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_value) VALUES(u,'request_status','branch_requests',request.id::text,jsonb_build_object('status',v_status,'note',v_note));
  RETURN jsonb_build_object('ok',true,'id',request.id);
 END IF;
 IF p_action NOT IN ('save_import','submit','review') THEN RETURN hospital_access_dispatch(p_action,p_payload); END IF;
 IF p_action IN ('save_import','submit') THEN
  v_month:=(p_payload->>'month')::date; v_snapshot:=(p_payload->>'snapshot_date')::date; v_kind:=p_payload->>'kind';
  IF v_kind='period_consumption' AND v_snapshot IS NULL THEN v_snapshot:=(p_payload->>'issued_to')::date; END IF;
  IF v_kind IS NULL OR v_kind NOT IN ('monthly','partial_update','weekly_update','full_snapshot','period_consumption') THEN RAISE EXCEPTION 'نوع التقرير غير صالح'; END IF;
  v_dates:=report_dates(v_month,v_snapshot,v_kind,p_payload);
 END IF;
 IF p_action='save_import' THEN
  IF NOT hospital_has_permission('data.upload') OR (coalesce((p_payload->>'confirm_revision')::boolean,false) AND NOT hospital_has_permission('data.correct')) THEN RAISE EXCEPTION 'صلاحية الرفع أو التصحيح غير مسموحة'; END IF;
  IF jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 50000 THEN RAISE EXCEPTION 'لا توجد صفوف صالحة'; END IF;
  SELECT jsonb_agg(jsonb_build_object('item_code',nullif(trim(e->>'item_code'),''),'item_name',nullif(trim(e->>'item_name'),''),'scientific_name',nullif(trim(e->>'scientific_name'),''),'trade_name',nullif(trim(e->>'trade_name'),''),'unit',nullif(trim(e->>'unit'),''),'location_name',trim(e->>'location_name'),'location_type',e->>'location_type',
   'issued_quantity',CASE WHEN v_kind IN ('monthly','period_consumption') THEN e->'issued_quantity' ELSE 'null'::jsonb END,
   'current_balance',CASE WHEN v_kind='period_consumption' THEN 'null'::jsonb ELSE e->'current_balance' END,
   'received_quantity',e->'received_quantity') ORDER BY e->>'location_name',e->>'item_code',e->>'item_name',e->>'unit')
   INTO v_rows FROM jsonb_array_elements(p_payload->'rows') e;
  FOR r IN SELECT value FROM jsonb_array_elements(v_rows) LOOP
   IF EXISTS(SELECT 1 FROM locations WHERE name=r->>'location_name' AND type::text=r->>'location_type' AND NOT active) THEN RAISE EXCEPTION 'الموقع موقوف؛ راجع المدير'; END IF;
   IF NOT EXISTS(SELECT 1 FROM locations WHERE name=r->>'location_name' AND type::text=r->>'location_type' AND active) AND NOT hospital_has_permission('users.manage') THEN RAISE EXCEPTION 'موقع جديد؛ اطلب من المدير تسجيله أولًا'; END IF;
   IF NOT hospital_has_permission('dictionary.write') AND (NOT EXISTS(SELECT 1 FROM inventory_movements WHERE item_code=r->>'item_code' AND unit=r->>'unit' AND item_name IS NOT DISTINCT FROM r->>'item_name' AND scientific_name IS NOT DISTINCT FROM r->>'scientific_name' AND trade_name IS NOT DISTINCT FROM r->>'trade_name')) THEN RAISE EXCEPTION 'الحفظ لصيدليتك وبالأصناف والوحدات والتعريفات المعروفة فقط'; END IF;
   IF NOT hospital_location_allowed(r->>'location_name',r->>'location_type') AND NOT(hospital_has_permission('users.manage') AND hospital_has_permission('data.branches') AND coalesce((hospital_access()->>'all_branches')::boolean,false) AND r->>'location_type'='sub_pharmacy') THEN RAISE EXCEPTION 'موقع خارج نطاق صلاحياتك'; END IF;
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
  PERFORM pg_advisory_xact_lock(hashtextextended('hospital-location-registration',0));
  INSERT INTO locations(name,type)
   SELECT DISTINCT e->>'location_name',(e->>'location_type')::public.location_type FROM jsonb_array_elements(v_rows) e
   WHERE NOT EXISTS(SELECT 1 FROM locations l WHERE l.name=e->>'location_name' AND l.type::text=e->>'location_type');
  v_id:=v_batch;
 ELSIF p_action='submit' THEN
  SELECT * INTO loc FROM locations WHERE id=(p_payload->>'location_id')::uuid AND type='sub_pharmacy' AND active;
  IF NOT FOUND OR NOT hospital_has_permission('data.upload') OR NOT hospital_location_id_allowed(loc.id) THEN RAISE EXCEPTION 'الصيدلية غير مسموحة'; END IF;
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
  v_hash:=md5(jsonb_build_array('direct-v3',loc.id,v_month,v_snapshot,v_kind,v_dates,v_rows)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_hash,0));
  SELECT id INTO v_id FROM branch_reports WHERE fingerprint=v_hash;
  IF FOUND THEN RETURN jsonb_build_object('ok',true,'duplicate',true,'id',v_id); END IF;
  SELECT jsonb_agg(jsonb_build_object('item_code',e->>'item_code','item_name',i.item_name,'scientific_name',i.scientific_name,'trade_name',i.trade_name,'unit',e->>'unit','location_name',loc.name,'location_type','sub_pharmacy','current_balance',e->'balance','issued_quantity',e->'issued')) INTO v_rows
   FROM jsonb_array_elements(v_rows) e CROSS JOIN LATERAL(SELECT item_name,scientific_name,trade_name FROM inventory_movements WHERE item_code=e->>'item_code' AND unit=e->>'unit' ORDER BY created_at DESC LIMIT 1)i;
  v_result:=hospital_operations('save_import',jsonb_build_object('file_name','تقرير '||loc.name,'month',v_month,'snapshot_date',v_snapshot,'kind',v_kind,'issued_from',v_dates->>'issued_from','issued_to',v_dates->>'issued_to','snapshot_boundary',v_dates->>'snapshot_boundary','rows',v_rows,'branch_submission',true,'confirm_revision',coalesce((p_payload->>'confirm_revision')::boolean,false)));
  IF coalesce((v_result->>'requiresRevision')::boolean,false) THEN RETURN v_result||jsonb_build_object('ok',true); END IF;
  v_batch:=(v_result->>'batchId')::uuid;
  SELECT jsonb_agg(jsonb_build_object('item_code',e->>'item_code','item_name',e->>'item_name','unit',e->>'unit','balance',e->'current_balance','issued',e->'issued_quantity')) INTO v_rows FROM jsonb_array_elements(v_rows)e;
  INSERT INTO branch_reports(location_id,month,snapshot_date,kind,entries,fingerprint,created_by,issued_from,issued_to,consumption_only,snapshot_boundary,status,batch_id,note,reviewed_by,reviewed_at)
   VALUES(loc.id,v_month,v_snapshot,CASE WHEN v_kind='period_consumption' THEN 'monthly' ELSE v_kind END,v_rows,v_hash,u,(v_dates->>'issued_from')::date,(v_dates->>'issued_to')::date,v_kind='period_consumption',v_dates->>'snapshot_boundary','approved',v_batch,'حفظ مباشر بعد التحقق؛ بدون مرحلة اعتماد',u,now()) RETURNING id INTO v_id;
 END IF;
 INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_value) VALUES(u,p_action,'hospital_operations',v_id::text,jsonb_build_object('status',v_status,'note',v_note,'dates',v_dates,'batch_id',v_batch));
 RETURN jsonb_build_object('ok',true,'id',v_id,'batchId',v_batch);
END; $$;

REVOKE ALL ON FUNCTION public.hospital_operations(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.hospital_operations(text,jsonb) TO authenticated;

-- Replace singleton-location restrictions with explicit scope checks.
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT schemaname,tablename,policyname FROM pg_policies WHERE schemaname='public' AND policyname LIKE 'hospital_branch_%' LOOP
  EXECUTE format('DROP POLICY %I ON %I.%I',r.policyname,r.schemaname,r.tablename);
 END LOOP;
END;$$;
CREATE POLICY acl_inventory_select ON inventory_movements AS RESTRICTIVE FOR SELECT TO authenticated USING(hospital_location_allowed(location_name,location_type));
CREATE POLICY acl_inventory_read_grant ON inventory_movements FOR SELECT TO authenticated USING(hospital_location_allowed(location_name,location_type));
CREATE POLICY acl_inventory_insert ON inventory_movements AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY acl_inventory_update ON inventory_movements AS RESTRICTIVE FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY acl_inventory_delete ON inventory_movements AS RESTRICTIVE FOR DELETE TO authenticated USING(hospital_has_permission('data.delete') AND hospital_location_allowed(location_name,location_type));
CREATE POLICY acl_batches_read ON upload_batches AS RESTRICTIVE FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM inventory_movements m WHERE m.upload_batch_id=upload_batches.id AND hospital_location_allowed(m.location_name,m.location_type)));
CREATE POLICY acl_batches_read_grant ON upload_batches FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM inventory_movements m WHERE m.upload_batch_id=upload_batches.id AND hospital_location_allowed(m.location_name,m.location_type)));
CREATE POLICY acl_batches_insert ON upload_batches AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(false);
CREATE POLICY acl_batches_update ON upload_batches AS RESTRICTIVE FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY acl_batches_delete ON upload_batches AS RESTRICTIVE FOR DELETE TO authenticated USING(hospital_has_permission('data.delete') AND NOT EXISTS(SELECT 1 FROM inventory_movements m WHERE m.upload_batch_id=upload_batches.id AND NOT hospital_location_allowed(m.location_name,m.location_type)));
CREATE OR REPLACE FUNCTION public.hospital_stock_write(kind text,fn text,ft text,tn text,tt text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce((fn IS NULL OR EXISTS(SELECT 1 FROM locations WHERE name=fn AND type::text=ft AND active)) AND (tn IS NULL OR EXISTS(SELECT 1 FROM locations WHERE name=tn AND type::text=tt AND active)) AND CASE kind
 WHEN 'warehouse_receipt' THEN hospital_has_permission('stock.receipt') AND fn IS NULL AND tt='main_warehouse' AND tn IS NOT NULL AND hospital_location_allowed(tn,tt)
 WHEN 'pharmacy_issue' THEN hospital_has_permission('stock.issue') AND tn IS NULL AND ft='sub_pharmacy' AND fn IS NOT NULL AND hospital_location_allowed(fn,ft)
 WHEN 'warehouse_issue_to_pharmacy' THEN hospital_has_permission('stock.transfer') AND ft='main_warehouse' AND tt='sub_pharmacy' AND fn IS NOT NULL AND tn IS NOT NULL AND hospital_location_allowed(fn,ft) AND hospital_location_allowed(tn,tt)
 WHEN 'pharmacy_transfer' THEN hospital_has_permission('stock.transfer') AND ft='sub_pharmacy' AND tt='sub_pharmacy' AND fn IS DISTINCT FROM tn AND fn IS NOT NULL AND tn IS NOT NULL AND hospital_location_allowed(fn,ft) AND hospital_location_allowed(tn,tt)
 WHEN 'warehouse_return' THEN hospital_has_permission('stock.return') AND ft='sub_pharmacy' AND tt='main_warehouse' AND fn IS NOT NULL AND tn IS NOT NULL AND hospital_location_allowed(fn,ft) AND hospital_location_allowed(tn,tt)
 WHEN 'pharmacy_return_to_warehouse' THEN hospital_has_permission('stock.return') AND ft='sub_pharmacy' AND tt='main_warehouse' AND fn IS NOT NULL AND tn IS NOT NULL AND hospital_location_allowed(fn,ft) AND hospital_location_allowed(tn,tt)
 ELSE false END,false);
$$;
CREATE POLICY acl_stock_read ON stock_transactions AS RESTRICTIVE FOR SELECT TO authenticated USING(hospital_location_allowed(from_location_name,from_location_type) OR hospital_location_allowed(to_location_name,to_location_type));
CREATE POLICY acl_stock_read_grant ON stock_transactions FOR SELECT TO authenticated USING(hospital_location_allowed(from_location_name,from_location_type) OR hospital_location_allowed(to_location_name,to_location_type));
CREATE POLICY acl_stock_insert ON stock_transactions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(qty>0 AND hospital_stock_write(txn_type,from_location_name,from_location_type,to_location_name,to_location_type));
CREATE POLICY acl_stock_insert_grant ON stock_transactions FOR INSERT TO authenticated WITH CHECK(qty>0 AND hospital_stock_write(txn_type,from_location_name,from_location_type,to_location_name,to_location_type));
CREATE POLICY acl_stock_update ON stock_transactions AS RESTRICTIVE FOR UPDATE TO authenticated USING(hospital_stock_write(txn_type,from_location_name,from_location_type,to_location_name,to_location_type)) WITH CHECK(qty>0 AND hospital_stock_write(txn_type,from_location_name,from_location_type,to_location_name,to_location_type));
CREATE POLICY acl_stock_update_grant ON stock_transactions FOR UPDATE TO authenticated USING(hospital_stock_write(txn_type,from_location_name,from_location_type,to_location_name,to_location_type)) WITH CHECK(hospital_stock_write(txn_type,from_location_name,from_location_type,to_location_name,to_location_type));
CREATE POLICY acl_stock_delete ON stock_transactions AS RESTRICTIVE FOR DELETE TO authenticated USING(hospital_has_permission('stock.delete') AND (from_location_name IS NULL OR hospital_location_allowed(from_location_name,from_location_type)) AND (to_location_name IS NULL OR hospital_location_allowed(to_location_name,to_location_type)));
CREATE POLICY acl_stock_delete_grant ON stock_transactions FOR DELETE TO authenticated USING(hospital_has_permission('stock.delete') AND (from_location_name IS NULL OR hospital_location_allowed(from_location_name,from_location_type)) AND (to_location_name IS NULL OR hospital_location_allowed(to_location_name,to_location_type)));
CREATE POLICY acl_locations ON locations AS RESTRICTIVE FOR SELECT TO authenticated USING(hospital_location_allowed(name,type::text));
CREATE POLICY acl_locations_grant ON locations FOR SELECT TO authenticated USING(hospital_location_allowed(name,type::text));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['forecasts','alerts','monthly_stock_movements'] LOOP
  EXECUTE format('CREATE POLICY acl_read ON %I AS RESTRICTIVE FOR SELECT TO authenticated USING(hospital_location_id_allowed(location_id))',t);
  EXECUTE format('CREATE POLICY acl_read_grant ON %I FOR SELECT TO authenticated USING(hospital_location_id_allowed(location_id))',t);
  EXECUTE format('CREATE POLICY acl_insert ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(hospital_has_permission(''data.upload'') AND hospital_location_id_allowed(location_id))',t);
  EXECUTE format('CREATE POLICY acl_update ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING(hospital_has_permission(''data.correct'') AND hospital_location_id_allowed(location_id)) WITH CHECK(hospital_has_permission(''data.correct'') AND hospital_location_id_allowed(location_id))',t);
  EXECUTE format('CREATE POLICY acl_delete ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING(hospital_has_permission(''data.delete'') AND hospital_location_id_allowed(location_id))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['branch_reports','branch_requests'] LOOP
  EXECUTE format('CREATE POLICY acl_read ON %I AS RESTRICTIVE FOR SELECT TO authenticated USING(hospital_location_id_allowed(location_id))',t);
  EXECUTE format('CREATE POLICY acl_read_grant ON %I FOR SELECT TO authenticated USING(hospital_location_id_allowed(location_id))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['data_quality_issues','import_ignored_rows','uploads'] LOOP
  EXECUTE format('CREATE POLICY acl_source ON %I AS RESTRICTIVE FOR ALL TO authenticated USING(NOT hospital_branch_user()) WITH CHECK(NOT hospital_branch_user() AND hospital_has_permission(''data.upload''))',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['item_master','active_ingredient_dictionary','drug_dictionary'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('CREATE POLICY acl_read ON %I AS RESTRICTIVE FOR SELECT TO authenticated USING(is_staff(auth.uid()))',t);
   EXECUTE format('CREATE POLICY acl_insert ON %I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(hospital_has_permission(''dictionary.write''))',t);
   EXECUTE format('CREATE POLICY acl_insert_grant ON %I FOR INSERT TO authenticated WITH CHECK(hospital_has_permission(''dictionary.write''))',t);
   EXECUTE format('CREATE POLICY acl_update ON %I AS RESTRICTIVE FOR UPDATE TO authenticated USING(hospital_has_permission(''dictionary.write'')) WITH CHECK(hospital_has_permission(''dictionary.write''))',t);
   EXECUTE format('CREATE POLICY acl_update_grant ON %I FOR UPDATE TO authenticated USING(hospital_has_permission(''dictionary.write'')) WITH CHECK(hospital_has_permission(''dictionary.write''))',t);
   EXECUTE format('CREATE POLICY acl_delete ON %I AS RESTRICTIVE FOR DELETE TO authenticated USING(hospital_has_permission(''data.delete''))',t);
  END IF;
 END LOOP;
END;$$;
CREATE POLICY acl_transfers ON transfers AS RESTRICTIVE FOR ALL TO authenticated USING(hospital_location_id_allowed(from_location_id) OR hospital_location_id_allowed(to_location_id)) WITH CHECK(hospital_has_permission('stock.transfer') AND hospital_location_id_allowed(from_location_id) AND hospital_location_id_allowed(to_location_id));
CREATE POLICY acl_transfers_grant ON transfers FOR ALL TO authenticated USING(hospital_location_id_allowed(from_location_id) OR hospital_location_id_allowed(to_location_id)) WITH CHECK(hospital_has_permission('stock.transfer') AND hospital_location_id_allowed(from_location_id) AND hospital_location_id_allowed(to_location_id));
CREATE POLICY acl_transfers_change ON transfers AS RESTRICTIVE FOR UPDATE TO authenticated USING(hospital_has_permission('stock.transfer') AND hospital_location_id_allowed(from_location_id) AND hospital_location_id_allowed(to_location_id)) WITH CHECK(hospital_has_permission('stock.transfer') AND hospital_location_id_allowed(from_location_id) AND hospital_location_id_allowed(to_location_id));
CREATE POLICY acl_transfers_delete ON transfers AS RESTRICTIVE FOR DELETE TO authenticated USING(hospital_has_permission('stock.delete') AND hospital_location_id_allowed(from_location_id) AND hospital_location_id_allowed(to_location_id));
CREATE POLICY acl_recommendations ON recommendation_actions AS RESTRICTIVE FOR ALL TO authenticated USING(hospital_has_permission('screen.daily') AND EXISTS(SELECT 1 FROM locations WHERE name IN (from_location,to_location) AND hospital_location_allowed(name,type::text))) WITH CHECK(hospital_has_permission('screen.daily') AND EXISTS(SELECT 1 FROM locations WHERE name IN (from_location,to_location) AND hospital_location_allowed(name,type::text)));
CREATE POLICY acl_recommendations_change ON recommendation_actions AS RESTRICTIVE FOR UPDATE TO authenticated USING(hospital_has_permission('stock.transfer')) WITH CHECK(hospital_has_permission('stock.transfer'));
CREATE POLICY acl_recommendations_insert ON recommendation_actions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(hospital_has_permission('stock.transfer'));
CREATE POLICY acl_recommendations_delete ON recommendation_actions AS RESTRICTIVE FOR DELETE TO authenticated USING(hospital_has_permission('stock.delete'));
CREATE POLICY acl_audit_read ON audit_log AS RESTRICTIVE FOR SELECT TO authenticated USING(user_id=auth.uid() OR hospital_has_permission('users.manage'));
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY acl_roles_write ON user_roles AS RESTRICTIVE FOR ALL TO authenticated USING(user_id=auth.uid() OR hospital_has_permission('users.manage')) WITH CHECK(has_role(auth.uid(),'system_admin'));
CREATE POLICY acl_roles_delete ON user_roles AS RESTRICTIVE FOR DELETE TO authenticated USING(has_role(auth.uid(),'system_admin') AND user_id<>auth.uid());
CREATE POLICY acl_profiles_write ON profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING(id=auth.uid() OR hospital_has_permission('users.manage')) WITH CHECK(id=auth.uid() OR hospital_has_permission('users.manage'));
CREATE POLICY acl_profiles_read ON profiles AS RESTRICTIVE FOR SELECT TO authenticated USING(id=auth.uid() OR hospital_has_permission('users.manage'));
REVOKE ALL ON FUNCTION hospital_access_dispatch(text,jsonb),seed_basic_access() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION hospital_access(),hospital_has_permission(text),hospital_stock_write(text,text,text,text,text),hospital_location_id_allowed(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hospital_access(),hospital_has_permission(text),hospital_stock_write(text,text,text,text,text),hospital_location_id_allowed(uuid) TO authenticated;

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
 RETURN jsonb_build_object('ok',true,'locations',result,'completeScope',hospital_has_permission('data.hospital') AND hospital_has_permission('data.warehouse') AND hospital_has_permission('data.branches') AND coalesce((hospital_access()->>'all_branches')::boolean,false));
END;$$;
COMMIT;

