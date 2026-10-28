INSERT INTO public.permission_catalog(key,groups,sensitive)
VALUES('decisions.write','["staff","manager"]'::jsonb,false) ON CONFLICT(key) DO NOTHING;
ALTER TABLE public.recommendation_actions
 ADD COLUMN IF NOT EXISTS item_code text,
 ADD COLUMN IF NOT EXISTS unit text,
 ADD COLUMN IF NOT EXISTS client_id uuid,
 ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'current',
 ADD COLUMN IF NOT EXISTS original_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS recaction_request_unique ON public.recommendation_actions(acted_by,client_id) WHERE client_id IS NOT NULL;
ALTER TABLE public.recommendation_actions ADD CONSTRAINT recaction_batch_reference FOREIGN KEY(upload_batch_id) REFERENCES public.upload_batches(id) NOT VALID;
CREATE OR REPLACE FUNCTION public.hospital_full_scope() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT hospital_has_permission('data.hospital') AND hospital_has_permission('data.branches') AND hospital_has_permission('data.warehouse') AND coalesce((hospital_access()->>'all_branches')::boolean,false);
$$;
CREATE OR REPLACE FUNCTION public.hospital_recommendation_location(n text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT n IS NULL OR CASE WHEN n='المستشفى' THEN hospital_full_scope() ELSE (SELECT count(*)=1 AND bool_and(hospital_location_allowed(name,type::text)) FROM locations WHERE name=n AND active) END;
$$;
CREATE OR REPLACE FUNCTION public.hospital_recommendation_visible(fn text,tn text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT hospital_full_scope() OR EXISTS(SELECT 1 FROM locations WHERE active AND name IN(fn,tn) AND hospital_location_allowed(name,type::text));
$$;
CREATE OR REPLACE FUNCTION public.guard_recommendation_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT hospital_has_permission('screen.daily') OR NOT hospital_has_permission('decisions.write') THEN RAISE EXCEPTION 'صلاحية تسجيل قرارات التوصيات غير مسموحة'; END IF;
 IF NEW.acted_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'مؤلف القرار غير مسموح'; END IF;
 IF NOT EXISTS(SELECT 1 FROM upload_batches WHERE id=NEW.upload_batch_id AND status='saved') THEN RAISE EXCEPTION 'ملف مصدر غير صالح'; END IF;
 NEW.from_location:=nullif(btrim(NEW.from_location),'');NEW.to_location:=nullif(btrim(NEW.to_location),'');
 IF NEW.to_location IS NULL OR NOT hospital_recommendation_location(NEW.from_location) OR NOT hospital_recommendation_location(NEW.to_location) THEN RAISE EXCEPTION 'موقع القرار خارج النطاق'; END IF;
 IF nullif(btrim(NEW.recommendation_key),'') IS NULL OR nullif(btrim(NEW.recommendation_type),'') IS NULL
  OR length(NEW.recommendation_key)>2000 OR length(NEW.recommendation_type)>100 OR length(NEW.note)>4000 OR length(NEW.item_name)>2000 OR length(NEW.item_key)>2000
  OR length(NEW.from_location)>200 OR length(NEW.to_location)>200 OR length(NEW.unit)>100 OR length(NEW.item_code)>200 OR length(NEW.override_reason)>2000 THEN RAISE EXCEPTION 'بيانات القرار غير صالحة'; END IF;
 IF NEW.suggested_qty<0 OR NEW.executed_qty<0 OR NEW.suggested_qty::text IN('NaN','Infinity','-Infinity') OR NEW.executed_qty::text IN('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'كمية قرار غير صالحة'; END IF;
 IF NEW.status::text='executed' AND (NEW.executed_qty IS NULL OR NEW.executed_qty<=0) THEN RAISE EXCEPTION 'اكتب كمية منفذة موجبة؛ القرار لا يحرك المخزون'; END IF;
 IF coalesce(NEW.match_review_required,false) AND NEW.status::text IN('approved','executed') AND (NOT coalesce(NEW.override_unreviewed,false) OR nullif(btrim(NEW.override_reason),'') IS NULL OR NOT hospital_has_permission('dictionary.write')) THEN RAISE EXCEPTION 'راجع المطابقة أو اطلب مسؤول القاموس وسجل سبب التجاوز'; END IF;
 IF NEW.source IS DISTINCT FROM 'current' OR NEW.original_at IS NOT NULL THEN RAISE EXCEPTION 'لا تنسب السجل الحالي إلى مصدر تاريخي'; END IF;
 NEW.client_id:=coalesce(NEW.client_id,gen_random_uuid());NEW.acted_at:=clock_timestamp();
 RETURN NEW;
END;$$;
CREATE OR REPLACE FUNCTION public.audit_recommendation_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO audit_log(user_id,action,entity_type,entity_id,new_value) VALUES(auth.uid(),'recommendation_decision','recommendation_action',NEW.id::text,to_jsonb(NEW));
 RETURN NEW;
END;$$;
CREATE TRIGGER recommendation_history_guard BEFORE INSERT ON public.recommendation_actions FOR EACH ROW EXECUTE FUNCTION public.guard_recommendation_history();
CREATE TRIGGER recommendation_history_audit AFTER INSERT ON public.recommendation_actions FOR EACH ROW EXECUTE FUNCTION public.audit_recommendation_history();
DROP POLICY IF EXISTS acl_recommendations ON public.recommendation_actions;
DROP POLICY IF EXISTS acl_recommendations_change ON public.recommendation_actions;
DROP POLICY IF EXISTS acl_recommendations_insert ON public.recommendation_actions;
DROP POLICY IF EXISTS acl_recommendations_delete ON public.recommendation_actions;
CREATE POLICY history_read ON public.recommendation_actions AS RESTRICTIVE FOR SELECT TO authenticated USING((hospital_has_permission('screen.actions-log') OR hospital_has_permission('screen.daily')) AND hospital_recommendation_visible(from_location,to_location));
CREATE POLICY history_read_grant ON public.recommendation_actions FOR SELECT TO authenticated USING((hospital_has_permission('screen.actions-log') OR hospital_has_permission('screen.daily')) AND hospital_recommendation_visible(from_location,to_location));
CREATE POLICY history_insert ON public.recommendation_actions AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(acted_by=auth.uid() AND hospital_has_permission('screen.daily') AND hospital_has_permission('decisions.write') AND hospital_recommendation_location(from_location) AND hospital_recommendation_location(to_location));
CREATE POLICY history_insert_grant ON public.recommendation_actions FOR INSERT TO authenticated WITH CHECK(acted_by=auth.uid() AND hospital_has_permission('screen.daily') AND hospital_has_permission('decisions.write') AND hospital_recommendation_location(from_location) AND hospital_recommendation_location(to_location));
CREATE POLICY history_no_update ON public.recommendation_actions AS RESTRICTIVE FOR UPDATE TO authenticated USING(false) WITH CHECK(false);
CREATE POLICY history_no_delete ON public.recommendation_actions AS RESTRICTIVE FOR DELETE TO authenticated USING(false);
