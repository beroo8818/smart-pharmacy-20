
-- ============== ENUMS ==============
CREATE TYPE public.app_role AS ENUM ('system_admin','pharmacy_manager','sub_pharmacist','warehouse_keeper','viewer');
CREATE TYPE public.location_type AS ENUM ('main_warehouse','sub_pharmacy');
CREATE TYPE public.transfer_type AS ENUM ('main_to_sub','sub_to_main','sub_to_sub');
CREATE TYPE public.transfer_status AS ENUM ('suggested','approved','done','cancelled');
CREATE TYPE public.alert_type AS ENUM ('shortage','overstock','deadstock','expiry','data','high_value_slow_moving');
CREATE TYPE public.alert_severity AS ENUM ('low','medium','high');
CREATE TYPE public.upload_status AS ENUM ('pending','validated','approved','rejected');
CREATE TYPE public.dqi_status AS ENUM ('open','fixed','ignored');

-- ============== LOCATIONS ==============
CREATE TABLE public.locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type public.location_type NOT NULL,
  parent_location_id UUID REFERENCES public.locations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============== PROFILES ==============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT '',
  email TEXT,
  assigned_location_id UUID REFERENCES public.locations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============== USER_ROLES (separate, anti-recursion) ==============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.user_location(_user_id UUID)
RETURNS UUID LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT assigned_location_id FROM public.profiles WHERE id = _user_id
$$;

-- ============== ITEMS ==============
CREATE TABLE public.item_master (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_code TEXT UNIQUE,
  normalized_item_key TEXT NOT NULL,
  item_name_ar TEXT,
  item_name_en TEXT,
  trade_name TEXT,
  active_ingredient_ar TEXT,
  active_ingredient_en TEXT,
  strength TEXT,
  dosage_form TEXT,
  unit TEXT,
  ven_class TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.item_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_master_id UUID NOT NULL REFERENCES public.item_master(id) ON DELETE CASCADE,
  alias_name TEXT NOT NULL,
  language TEXT,
  source TEXT,
  confidence_score NUMERIC DEFAULT 1.0
);

-- ============== STOCK ==============
CREATE TABLE public.uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename TEXT NOT NULL,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status public.upload_status NOT NULL DEFAULT 'pending',
  error_count INT DEFAULT 0
);

CREATE TABLE public.monthly_stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id),
  item_master_id UUID NOT NULL REFERENCES public.item_master(id),
  batch_no TEXT,
  opening_balance NUMERIC DEFAULT 0,
  received_qty NUMERIC DEFAULT 0,
  issued_qty NUMERIC DEFAULT 0,
  closing_balance NUMERIC DEFAULT 0,
  returns_qty NUMERIC DEFAULT 0,
  transfer_in_qty NUMERIC DEFAULT 0,
  transfer_out_qty NUMERIC DEFAULT 0,
  expiry_date DATE,
  min_stock NUMERIC,
  max_stock NUMERIC,
  lead_time_days INT,
  unit_price NUMERIC,
  uploaded_file_id UUID REFERENCES public.uploads(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_msm_month ON public.monthly_stock_movements(month);
CREATE INDEX idx_msm_loc ON public.monthly_stock_movements(location_id);
CREATE INDEX idx_msm_item ON public.monthly_stock_movements(item_master_id);

CREATE TABLE public.transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL,
  from_location_id UUID NOT NULL REFERENCES public.locations(id),
  to_location_id UUID NOT NULL REFERENCES public.locations(id),
  item_master_id UUID NOT NULL REFERENCES public.item_master(id),
  batch_no TEXT,
  qty NUMERIC NOT NULL,
  transfer_type public.transfer_type NOT NULL,
  status public.transfer_status NOT NULL DEFAULT 'suggested',
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.data_quality_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID REFERENCES public.uploads(id) ON DELETE CASCADE,
  row_no INT,
  issue_type TEXT NOT NULL,
  severity public.alert_severity NOT NULL DEFAULT 'medium',
  message_ar TEXT NOT NULL,
  suggested_fix TEXT,
  status public.dqi_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id),
  item_master_id UUID NOT NULL REFERENCES public.item_master(id),
  forecast_next_month NUMERIC,
  forecast_3_months NUMERIC,
  method TEXT,
  confidence TEXT,
  notes_ar TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL,
  location_id UUID NOT NULL REFERENCES public.locations(id),
  item_master_id UUID NOT NULL REFERENCES public.item_master(id),
  alert_type public.alert_type NOT NULL,
  severity public.alert_severity NOT NULL,
  message_ar TEXT NOT NULL,
  why_ar TEXT,
  action_ar TEXT,
  status TEXT DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============== TRIGGERS: auto profile on signup ==============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name',''), NEW.email);
  -- default to viewer role
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'viewer')
    ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============== RLS ==============
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_master ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.data_quality_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Profiles: own read/update; admins all
CREATE POLICY "profiles_own_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'));
CREATE POLICY "profiles_own_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(),'system_admin'));
CREATE POLICY "profiles_admin_insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(),'system_admin'));

-- user_roles: only admins manage; users can read own
CREATE POLICY "roles_admin_all" ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin')) WITH CHECK (public.has_role(auth.uid(),'system_admin'));
CREATE POLICY "roles_self_read" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- locations: any authenticated staff can read
CREATE POLICY "loc_read" ON public.locations FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "loc_admin_write" ON public.locations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'));

-- item_master / aliases: staff read; managers+admins write
CREATE POLICY "items_read" ON public.item_master FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "items_write" ON public.item_master FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager') OR public.has_role(auth.uid(),'warehouse_keeper'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager') OR public.has_role(auth.uid(),'warehouse_keeper'));
CREATE POLICY "aliases_read" ON public.item_aliases FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "aliases_write" ON public.item_aliases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'));

-- uploads
CREATE POLICY "uploads_read" ON public.uploads FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "uploads_insert" ON public.uploads FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND public.is_staff(auth.uid()));
CREATE POLICY "uploads_update" ON public.uploads FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() OR public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'));

-- monthly_stock_movements: scoped by location for sub_pharmacist
CREATE POLICY "msm_read" ON public.monthly_stock_movements FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'system_admin')
  OR public.has_role(auth.uid(),'pharmacy_manager')
  OR public.has_role(auth.uid(),'viewer')
  OR (public.has_role(auth.uid(),'warehouse_keeper'))
  OR (public.has_role(auth.uid(),'sub_pharmacist') AND location_id = public.user_location(auth.uid()))
);
CREATE POLICY "msm_write" ON public.monthly_stock_movements FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'pharmacy_manager')
    OR public.has_role(auth.uid(),'warehouse_keeper')
    OR (public.has_role(auth.uid(),'sub_pharmacist') AND location_id = public.user_location(auth.uid()))
  )
  WITH CHECK (
    public.has_role(auth.uid(),'system_admin')
    OR public.has_role(auth.uid(),'pharmacy_manager')
    OR public.has_role(auth.uid(),'warehouse_keeper')
    OR (public.has_role(auth.uid(),'sub_pharmacist') AND location_id = public.user_location(auth.uid()))
  );

-- transfers
CREATE POLICY "transfers_read" ON public.transfers FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'system_admin')
  OR public.has_role(auth.uid(),'pharmacy_manager')
  OR public.has_role(auth.uid(),'warehouse_keeper')
  OR public.has_role(auth.uid(),'viewer')
  OR (public.has_role(auth.uid(),'sub_pharmacist') AND (from_location_id = public.user_location(auth.uid()) OR to_location_id = public.user_location(auth.uid())))
);
CREATE POLICY "transfers_write" ON public.transfers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager') OR public.has_role(auth.uid(),'warehouse_keeper'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager') OR public.has_role(auth.uid(),'warehouse_keeper'));

-- DQI
CREATE POLICY "dqi_read" ON public.data_quality_issues FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "dqi_write" ON public.data_quality_issues FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- forecasts
CREATE POLICY "fc_read" ON public.forecasts FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY "fc_write" ON public.forecasts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'));

-- alerts
CREATE POLICY "al_read" ON public.alerts FOR SELECT TO authenticated USING (
  public.has_role(auth.uid(),'system_admin')
  OR public.has_role(auth.uid(),'pharmacy_manager')
  OR public.has_role(auth.uid(),'warehouse_keeper')
  OR public.has_role(auth.uid(),'viewer')
  OR (public.has_role(auth.uid(),'sub_pharmacist') AND location_id = public.user_location(auth.uid()))
);
CREATE POLICY "al_write" ON public.alerts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'))
  WITH CHECK (public.has_role(auth.uid(),'system_admin') OR public.has_role(auth.uid(),'pharmacy_manager'));

-- audit_log
CREATE POLICY "audit_read" ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'system_admin'));
CREATE POLICY "audit_insert" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
