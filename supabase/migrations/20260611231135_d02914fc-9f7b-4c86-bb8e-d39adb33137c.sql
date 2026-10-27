-- دالة آمنة: ترجع اسم الموقع المخصّص للمستخدم (SECURITY DEFINER لتفادي التكرار في RLS)
CREATE OR REPLACE FUNCTION public.user_location_name(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.name
  FROM public.profiles p
  JOIN public.locations l ON l.id = p.assigned_location_id
  WHERE p.id = _user_id
$$;

-- ============ inventory_movements: تقييد الصيدلي الفرعي على فرعه + المخزن الرئيسي ============
DROP POLICY IF EXISTS inventory_movements_read ON public.inventory_movements;
CREATE POLICY inventory_movements_read ON public.inventory_movements
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin'::app_role)
  OR has_role(auth.uid(), 'pharmacy_manager'::app_role)
  OR has_role(auth.uid(), 'warehouse_keeper'::app_role)
  OR has_role(auth.uid(), 'viewer'::app_role)
  OR (
    has_role(auth.uid(), 'sub_pharmacist'::app_role)
    AND (
      location_type = 'main_warehouse'
      OR location_name = public.user_location_name(auth.uid())
    )
  )
);

-- ============ stock_transactions: الصيدلي الفرعي يرى فقط حركاته/حركات فرعه ============
DROP POLICY IF EXISTS stx_read ON public.stock_transactions;
CREATE POLICY stx_read ON public.stock_transactions
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin'::app_role)
  OR has_role(auth.uid(), 'pharmacy_manager'::app_role)
  OR has_role(auth.uid(), 'warehouse_keeper'::app_role)
  OR has_role(auth.uid(), 'viewer'::app_role)
  OR (
    has_role(auth.uid(), 'sub_pharmacist'::app_role)
    AND (
      from_location_name = public.user_location_name(auth.uid())
      OR to_location_name = public.user_location_name(auth.uid())
    )
  )
);

-- ============ recommendation_actions: الصيدلي الفرعي يرى توصيات فرعه فقط ============
DROP POLICY IF EXISTS recact_read ON public.recommendation_actions;
CREATE POLICY recact_read ON public.recommendation_actions
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin'::app_role)
  OR has_role(auth.uid(), 'pharmacy_manager'::app_role)
  OR has_role(auth.uid(), 'warehouse_keeper'::app_role)
  OR has_role(auth.uid(), 'viewer'::app_role)
  OR (
    has_role(auth.uid(), 'sub_pharmacist'::app_role)
    AND (
      from_location = public.user_location_name(auth.uid())
      OR to_location = public.user_location_name(auth.uid())
    )
  )
);

-- ============ audit_log: منع المشاهد من قراءة سجل التدقيق ============
DROP POLICY IF EXISTS audit_read ON public.audit_log;
CREATE POLICY audit_read ON public.audit_log
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'system_admin'::app_role)
  OR has_role(auth.uid(), 'pharmacy_manager'::app_role)
);