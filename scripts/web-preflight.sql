-- Read-only metadata checks. Run only on an authorized test database.
BEGIN TRANSACTION READ ONLY;
SELECT current_database() AS database_name, current_user AS inspected_as,
       current_setting('server_version') AS server_version;
SELECT name, to_regclass(name) IS NOT NULL AS exists
FROM unnest(ARRAY['auth.users','public.profiles','public.user_roles',
 'public.locations','public.upload_batches','public.inventory_movements',
 'public.stock_transactions','public.recommendation_actions','public.audit_log',
 'supabase_migrations.schema_migrations']) AS name;
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('locations','stock_transactions','recommendation_actions','permission_catalog')
ORDER BY table_name,ordinal_position;
SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,
 count(p.oid) AS policy_count
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_policy p ON p.polrelid=c.oid
WHERE n.nspname='public' AND c.relname IN
 ('inventory_movements','stock_transactions','recommendation_actions','user_access_profiles')
GROUP BY c.oid,c.relname,c.relrowsecurity ORDER BY c.relname;
SELECT proname,pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname IN
 ('hospital_access','hospital_has_permission','guard_recommendation_history')
ORDER BY proname;
ROLLBACK;
