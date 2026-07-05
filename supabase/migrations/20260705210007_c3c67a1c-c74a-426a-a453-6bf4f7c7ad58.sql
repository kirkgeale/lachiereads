
CREATE TABLE public.assessment_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  probes_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  events_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  report_json jsonb,
  summary text,
  estimated_level text,
  applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_reports TO authenticated;
GRANT ALL ON public.assessment_reports TO service_role;

ALTER TABLE public.assessment_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parent manages own learner assessments" ON public.assessment_reports
  FOR ALL TO authenticated
  USING (public.owns_learner(learner_id))
  WITH CHECK (public.owns_learner(learner_id));

CREATE TRIGGER trg_assessment_reports_updated
  BEFORE UPDATE ON public.assessment_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
