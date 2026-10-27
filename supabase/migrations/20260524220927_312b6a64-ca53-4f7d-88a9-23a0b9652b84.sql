-- 1) Stop auto-assigning 'viewer' role on signup; admins must explicitly grant access.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name',''), NEW.email);
  -- No default role: new users have no access until an admin assigns a role.
  RETURN NEW;
END;
$function$;

-- 2) Lock down SECURITY DEFINER functions so they aren't directly callable from PostgREST.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.wipe_all_inventory_data() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_staff(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_location(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;

-- Helper functions are still needed by RLS policies for signed-in users.
GRANT EXECUTE ON FUNCTION public.is_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_location(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;