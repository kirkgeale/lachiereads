REVOKE EXECUTE ON FUNCTION public.bump_content_gen_seq(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bump_content_gen_seq(uuid) TO authenticated, service_role;