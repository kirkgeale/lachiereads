
CREATE TYPE public.math_strand AS ENUM (
  'counting','subitizing','comparison','number_bonds',
  'addition','subtraction','place_value','word_problems'
);

ALTER TYPE public.session_item_type ADD VALUE IF NOT EXISTS 'math_skill';
ALTER TYPE public.session_item_type ADD VALUE IF NOT EXISTS 'math_fact';

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT 'reading';
ALTER TABLE public.assessment_reports
  ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT 'reading';
ALTER TABLE public.generated_content
  ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT 'reading';

CREATE INDEX IF NOT EXISTS idx_sessions_learner_subject
  ON public.sessions(learner_id, subject);
CREATE INDEX IF NOT EXISTS idx_assessment_reports_learner_subject
  ON public.assessment_reports(learner_id, subject);

CREATE TABLE public.math_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL,
  strand math_strand NOT NULL,
  phase int NOT NULL,
  order_index int NOT NULL,
  self_gradable boolean NOT NULL DEFAULT false,
  max_value int NOT NULL DEFAULT 10,
  example_problem text
);
GRANT SELECT ON public.math_skills TO authenticated;
GRANT ALL ON public.math_skills TO service_role;
ALTER TABLE public.math_skills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "math_skills readable" ON public.math_skills
  FOR SELECT TO authenticated USING (true);

CREATE TABLE public.learner_math_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  skill_id uuid NOT NULL REFERENCES public.math_skills(id) ON DELETE CASCADE,
  status public.item_status NOT NULL DEFAULT 'not_started',
  leitner_box int NOT NULL DEFAULT 1,
  correct_streak int NOT NULL DEFAULT 0,
  next_due_date date NOT NULL DEFAULT current_date,
  last_seen timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(learner_id, skill_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_math_status TO authenticated;
GRANT ALL ON public.learner_math_status TO service_role;
ALTER TABLE public.learner_math_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "learner_math_status owner" ON public.learner_math_status
  FOR ALL TO authenticated
  USING (private.owns_learner(learner_id))
  WITH CHECK (private.owns_learner(learner_id));
CREATE TRIGGER trg_lms_updated BEFORE UPDATE ON public.learner_math_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_lms_learner_due
  ON public.learner_math_status(learner_id, next_due_date);

CREATE OR REPLACE FUNCTION public.handle_new_learner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.rewards (learner_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.learner_gpc_status (learner_id, gpc_id)
    SELECT NEW.id, g.id FROM public.gpcs g ON CONFLICT DO NOTHING;
  INSERT INTO public.learner_heart_word_status (learner_id, heart_word_id)
    SELECT NEW.id, h.id FROM public.heart_words h ON CONFLICT DO NOTHING;
  INSERT INTO public.learner_interference_status (learner_id, interference_id)
    SELECT NEW.id, i.id FROM public.interference_items i ON CONFLICT DO NOTHING;
  INSERT INTO public.learner_math_status (learner_id, skill_id)
    SELECT NEW.id, s.id FROM public.math_skills s ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

INSERT INTO public.math_skills (code, name, description, strand, phase, order_index, self_gradable, max_value, example_problem) VALUES
('count_to_10','Count to 10','Say the number names in order up to ten.','counting',1,10,false,10,'Count: 1, 2, 3…'),
('count_objects_10','Count objects to 10','Touch and count up to ten objects, one number per object.','counting',1,20,false,10,'Count these blocks.'),
('cardinality','How many altogether','Know the last number counted tells how many there are.','counting',1,30,false,10,'How many are there?'),
('count_to_20','Count to 20','Say the number names in order up to twenty.','counting',1,40,false,20,'Count: 1, 2…20'),
('count_back_10','Count back from 10','Say numbers in reverse from ten.','counting',1,50,false,10,'10, 9, 8…'),
('subitize_5','See how many up to 5 instantly','Recognise small groups without counting.','subitizing',2,60,false,5,'How many dots?'),
('subitize_10','See patterns up to 10','Recognise familiar dot patterns to ten.','subitizing',2,70,false,10,'How many dots?'),
('compare_10','More, less, or equal to 10','Compare two amounts and say which is greater.','comparison',3,80,false,10,'Which is more, 6 or 8?'),
('order_10','Put numbers in order to 10','Arrange numbers smallest to largest.','comparison',3,90,false,10,'Put in order: 4, 1, 7'),
('number_line_10','Find numbers on a line to 10','Locate a number on a 0–10 line.','comparison',3,100,false,10,'Show me 6 on the line.'),
('compare_20','More or less to 20','Compare two amounts within twenty.','comparison',3,110,false,20,'Which is more, 12 or 15?'),
('bonds_5','Pairs that make 5','Know the pairs of numbers that add to five.','number_bonds',4,120,true,5,'4 + ? = 5'),
('bonds_10','Pairs that make 10','Know the pairs of numbers that add to ten.','number_bonds',4,130,true,10,'7 + ? = 10'),
('part_whole','Part-part-whole to 10','Break a number into two parts and back again.','number_bonds',4,140,false,10,'8 is 3 and ?'),
('add_0_1','Add 0 and add 1','Adding zero keeps it the same; adding one is the next number.','addition',5,150,true,10,'6 + 1 = ?'),
('add_within_5','Add within 5','Add two numbers whose total is at most five.','addition',5,160,true,5,'2 + 3 = ?'),
('doubles_5','Doubles to 5+5','Know 1+1 up to 5+5.','addition',5,170,true,10,'4 + 4 = ?'),
('add_within_10','Add within 10','Add two numbers whose total is at most ten.','addition',5,180,true,10,'6 + 3 = ?'),
('make_ten','Make-ten strategy','Break a number apart to make ten first.','addition',5,190,true,10,'9 + 3 → 10 + 2'),
('sub_within_5','Subtract within 5','Take one number away from another, within five.','subtraction',6,200,true,5,'4 − 2 = ?'),
('sub_within_10','Subtract within 10','Take away within ten.','subtraction',6,210,true,10,'9 − 4 = ?'),
('fact_families_10','Fact families to 10','Know how add and subtract facts connect.','subtraction',6,220,true,10,'3+4=7, 7−4=3'),
('add_within_20','Add within 20','Add two numbers whose total is at most twenty.','addition',7,230,true,20,'8 + 6 = ?'),
('doubles_10','Doubles to 10+10','Know doubles up to ten plus ten.','addition',7,240,true,20,'7 + 7 = ?'),
('near_doubles','Near doubles','Use doubles to solve almost-doubles.','addition',7,250,true,20,'6 + 7 → 6+6+1'),
('sub_within_20','Subtract within 20','Take away within twenty.','subtraction',7,260,true,20,'14 − 5 = ?'),
('teen_ten_ones','Teen numbers as ten-and-ones','See 13 as a ten and three ones.','place_value',8,270,false,20,'13 = 10 + 3'),
('tens_ones_100','Tens and ones to 100','Split two-digit numbers into tens and ones.','place_value',8,280,false,100,'34 = 3 tens and 4'),
('skip_2_5_10','Skip count 2s, 5s, 10s','Count in steps of 2, 5, and 10.','place_value',8,290,true,100,'2, 4, 6, 8…'),
('word_add_10','Add in a story to 10','Solve one-step add problems in words within ten.','word_problems',9,300,false,10,'Sam had 4, got 3 more…'),
('word_sub_10','Take away in a story to 10','Solve one-step take-away problems within ten.','word_problems',9,310,false,10,'Sam had 8, gave 3 away…'),
('word_add_20','Add in a story to 20','Solve one-step add problems in words within twenty.','word_problems',9,320,false,20,'Sam had 9, got 5 more…')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.learner_math_status (learner_id, skill_id)
SELECT l.id, s.id FROM public.learners l CROSS JOIN public.math_skills s
ON CONFLICT DO NOTHING;
