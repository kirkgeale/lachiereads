
-- Move SECURITY DEFINER helper functions out of the exposed public schema
CREATE SCHEMA IF NOT EXISTS private;

-- Recreate has_role in private schema
CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Recreate owns_learner in private schema
CREATE OR REPLACE FUNCTION private.owns_learner(_learner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.learners WHERE id = _learner_id AND parent_id = auth.uid());
$$;

-- Lock down execution: only postgres/service_role can call directly; policies call as table owner via SECURITY DEFINER chain
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.owns_learner(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO service_role;
GRANT EXECUTE ON FUNCTION private.owns_learner(uuid) TO service_role;

-- Grant usage of the private schema to auth roles so RLS policies can resolve function references
GRANT USAGE ON SCHEMA private TO authenticated, anon, service_role;
-- Also allow policy evaluation to call these (policies run as invoker; needed for RLS to succeed)
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION private.owns_learner(uuid) TO authenticated;

-- Rebuild every policy that referenced the public.* variants to use private.*
-- learners
DROP POLICY IF EXISTS "parents manage own learners" ON public.learners;
CREATE POLICY "parents manage own learners" ON public.learners
  FOR ALL TO authenticated
  USING (parent_id = auth.uid()) WITH CHECK (parent_id = auth.uid());

-- Helper to rebuild owns_learner policies quickly via DO block
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, cmd, qual, with_check, roles
    FROM pg_policies
    WHERE schemaname='public'
      AND (qual LIKE '%owns_learner%' OR with_check LIKE '%owns_learner%' OR qual LIKE '%has_role%' OR with_check LIKE '%has_role%')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Recreate policies using private.owns_learner
CREATE POLICY "learner_gpc_status owner" ON public.learner_gpc_status
  FOR ALL TO authenticated
  USING (private.owns_learner(learner_id)) WITH CHECK (private.owns_learner(learner_id));

CREATE POLICY "learner_heart_word_status owner" ON public.learner_heart_word_status
  FOR ALL TO authenticated
  USING (private.owns_learner(learner_id)) WITH CHECK (private.owns_learner(learner_id));

CREATE POLICY "learner_interference_status owner" ON public.learner_interference_status
  FOR ALL TO authenticated
  USING (private.owns_learner(learner_id)) WITH CHECK (private.owns_learner(learner_id));

CREATE POLICY "sessions owner" ON public.sessions
  FOR ALL TO authenticated
  USING (private.owns_learner(learner_id)) WITH CHECK (private.owns_learner(learner_id));

CREATE POLICY "session_events owner" ON public.session_events
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND private.owns_learner(s.learner_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND private.owns_learner(s.learner_id)));

CREATE POLICY "rewards owner" ON public.rewards
  FOR ALL TO authenticated
  USING (private.owns_learner(learner_id)) WITH CHECK (private.owns_learner(learner_id));

CREATE POLICY "generated_content owner" ON public.generated_content
  FOR SELECT TO authenticated
  USING (learner_id IS NULL OR private.owns_learner(learner_id));
CREATE POLICY "generated_content owner write" ON public.generated_content
  FOR INSERT TO authenticated
  WITH CHECK (learner_id IS NULL OR private.owns_learner(learner_id));

CREATE POLICY "assessment_reports owner" ON public.assessment_reports
  FOR ALL TO authenticated
  USING (private.owns_learner(learner_id)) WITH CHECK (private.owns_learner(learner_id));

-- Drop the now-unused public.* functions
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role);
DROP FUNCTION IF EXISTS public.owns_learner(uuid);

-- Harden user_roles read: make policy explicit and non-anonymous
DROP POLICY IF EXISTS "own roles readable" ON public.user_roles;
CREATE POLICY "own roles readable" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
  );
