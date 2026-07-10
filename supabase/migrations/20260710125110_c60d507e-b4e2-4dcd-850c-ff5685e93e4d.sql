
ALTER TABLE public.gpcs ADD COLUMN IF NOT EXISTS assessment_word_pool text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.learners ADD COLUMN IF NOT EXISTS content_gen_seq integer NOT NULL DEFAULT 0;

-- Seed a small decodable pool for common graphemes. Fallback in code covers the rest.
UPDATE public.gpcs SET assessment_word_pool = ARRAY['sat','mat','pan','tap']    WHERE grapheme = 'a' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['sit','pin','tip','fit']    WHERE grapheme = 'i' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['pot','top','hot','dog']    WHERE grapheme = 'o' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['sun','cup','mug','bun']    WHERE grapheme = 'u' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['pet','ten','red','leg']    WHERE grapheme = 'e' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['ship','shop','fish','shed'] WHERE grapheme = 'sh' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['chin','chop','chat','chip'] WHERE grapheme = 'ch' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['this','then','thin','with'] WHERE grapheme = 'th' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['sock','pick','duck','back'] WHERE grapheme = 'ck' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['ring','sing','long','king'] WHERE grapheme = 'ng' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['rain','pain','wait','main'] WHERE grapheme = 'ai' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['see','feet','need','week']  WHERE grapheme = 'ee' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);
UPDATE public.gpcs SET assessment_word_pool = ARRAY['boat','coat','soap','road'] WHERE grapheme = 'oa' AND (assessment_word_pool IS NULL OR array_length(assessment_word_pool,1) IS NULL);

-- Atomic per-learner content sequence bump.
CREATE OR REPLACE FUNCTION public.bump_content_gen_seq(p_learner_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.learners
     SET content_gen_seq = content_gen_seq + 1
   WHERE id = p_learner_id
  RETURNING content_gen_seq;
$$;

GRANT EXECUTE ON FUNCTION public.bump_content_gen_seq(uuid) TO authenticated, service_role;
