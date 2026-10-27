
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_location(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
