REVOKE EXECUTE ON FUNCTION public.user_location_name(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_location_name(uuid) TO authenticated, service_role;