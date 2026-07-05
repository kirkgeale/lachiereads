
-- Enums
CREATE TYPE public.app_role AS ENUM ('parent');
CREATE TYPE public.gpc_type AS ENUM ('single','digraph','split_digraph','vowel_team');
CREATE TYPE public.item_status AS ENUM ('not_started','learning','practising','secure');
CREATE TYPE public.interference_status AS ENUM ('still_confuses','resolving','secure');
CREATE TYPE public.outcome AS ENUM ('got_it','hesitated','missed');
CREATE TYPE public.session_item_type AS ENUM ('gpc','heart_word','decodable_word');
CREATE TYPE public.content_type AS ENUM ('word_list','sentence','story','game_words','pseudowords');

-- Updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- USER ROLES
CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'parent',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own roles readable" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- Auto-assign parent role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'parent')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.parent_settings (parent_id) VALUES (NEW.id)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

-- PARENT SETTINGS (created before trigger)
CREATE TABLE public.parent_settings (
  parent_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pin_hash text,
  dyslexia_font boolean NOT NULL DEFAULT false,
  active_learner_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.parent_settings TO authenticated;
GRANT ALL ON public.parent_settings TO service_role;
ALTER TABLE public.parent_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.parent_settings FOR ALL TO authenticated
  USING (parent_id = auth.uid()) WITH CHECK (parent_id = auth.uid());
CREATE TRIGGER trg_parent_settings_updated BEFORE UPDATE ON public.parent_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- LEARNERS
CREATE TABLE public.learners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  birthdate date,
  notes text,
  garden_theme text NOT NULL DEFAULT 'meadow',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learners TO authenticated;
GRANT ALL ON public.learners TO service_role;
ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own learners" ON public.learners FOR ALL TO authenticated
  USING (parent_id = auth.uid()) WITH CHECK (parent_id = auth.uid());
CREATE TRIGGER trg_learners_updated BEFORE UPDATE ON public.learners
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper: is learner owned by current user?
CREATE OR REPLACE FUNCTION public.owns_learner(_learner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.learners WHERE id = _learner_id AND parent_id = auth.uid());
$$;

-- GPCs (seed phonics spine)
CREATE TABLE public.gpcs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grapheme text NOT NULL UNIQUE,
  sound_label text NOT NULL,
  phase int NOT NULL,
  order_index int NOT NULL,
  type gpc_type NOT NULL,
  example_word text NOT NULL
);
GRANT SELECT ON public.gpcs TO authenticated;
GRANT ALL ON public.gpcs TO service_role;
ALTER TABLE public.gpcs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gpcs readable to signed-in" ON public.gpcs FOR SELECT TO authenticated USING (true);

-- HEART WORDS
CREATE TABLE public.heart_words (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  word text NOT NULL UNIQUE,
  order_index int NOT NULL
);
GRANT SELECT ON public.heart_words TO authenticated;
GRANT ALL ON public.heart_words TO service_role;
ALTER TABLE public.heart_words ENABLE ROW LEVEL SECURITY;
CREATE POLICY "heart_words readable" ON public.heart_words FOR SELECT TO authenticated USING (true);

-- INTERFERENCE
CREATE TABLE public.interference_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grapheme text NOT NULL UNIQUE,
  swedish_value text NOT NULL,
  english_value text NOT NULL,
  note text,
  example_word text NOT NULL
);
GRANT SELECT ON public.interference_items TO authenticated;
GRANT ALL ON public.interference_items TO service_role;
ALTER TABLE public.interference_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "interference readable" ON public.interference_items FOR SELECT TO authenticated USING (true);

-- PER-LEARNER STATUS TABLES
CREATE TABLE public.learner_gpc_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  gpc_id uuid NOT NULL REFERENCES public.gpcs(id) ON DELETE CASCADE,
  status item_status NOT NULL DEFAULT 'not_started',
  leitner_box int NOT NULL DEFAULT 1,
  next_due_date date NOT NULL DEFAULT current_date,
  last_seen timestamptz,
  correct_streak int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(learner_id, gpc_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_gpc_status TO authenticated;
GRANT ALL ON public.learner_gpc_status TO service_role;
ALTER TABLE public.learner_gpc_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own learner gpc status" ON public.learner_gpc_status FOR ALL TO authenticated
  USING (public.owns_learner(learner_id)) WITH CHECK (public.owns_learner(learner_id));
CREATE TRIGGER trg_lgs_updated BEFORE UPDATE ON public.learner_gpc_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.learner_heart_word_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  heart_word_id uuid NOT NULL REFERENCES public.heart_words(id) ON DELETE CASCADE,
  status item_status NOT NULL DEFAULT 'not_started',
  leitner_box int NOT NULL DEFAULT 1,
  next_due_date date NOT NULL DEFAULT current_date,
  last_seen timestamptz,
  correct_streak int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(learner_id, heart_word_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_heart_word_status TO authenticated;
GRANT ALL ON public.learner_heart_word_status TO service_role;
ALTER TABLE public.learner_heart_word_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own learner heart status" ON public.learner_heart_word_status FOR ALL TO authenticated
  USING (public.owns_learner(learner_id)) WITH CHECK (public.owns_learner(learner_id));
CREATE TRIGGER trg_lhws_updated BEFORE UPDATE ON public.learner_heart_word_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.learner_interference_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  interference_id uuid NOT NULL REFERENCES public.interference_items(id) ON DELETE CASCADE,
  status interference_status NOT NULL DEFAULT 'still_confuses',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(learner_id, interference_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.learner_interference_status TO authenticated;
GRANT ALL ON public.learner_interference_status TO service_role;
ALTER TABLE public.learner_interference_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own learner interference" ON public.learner_interference_status FOR ALL TO authenticated
  USING (public.owns_learner(learner_id)) WITH CHECK (public.owns_learner(learner_id));
CREATE TRIGGER trg_lis_updated BEFORE UPDATE ON public.learner_interference_status
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- SESSIONS
CREATE TABLE public.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  date timestamptz NOT NULL DEFAULT now(),
  plan_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  duration_seconds int NOT NULL DEFAULT 0,
  parent_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sessions" ON public.sessions FOR ALL TO authenticated
  USING (public.owns_learner(learner_id)) WITH CHECK (public.owns_learner(learner_id));

CREATE TABLE public.session_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  item_type session_item_type NOT NULL,
  item_ref text NOT NULL,
  outcome outcome NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.session_events TO authenticated;
GRANT ALL ON public.session_events TO service_role;
ALTER TABLE public.session_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own session events" ON public.session_events FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND public.owns_learner(s.learner_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND public.owns_learner(s.learner_id)));

-- BENCHMARKS
CREATE TABLE public.benchmarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  date timestamptz NOT NULL DEFAULT now(),
  scores_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.benchmarks TO authenticated;
GRANT ALL ON public.benchmarks TO service_role;
ALTER TABLE public.benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own benchmarks" ON public.benchmarks FOR ALL TO authenticated
  USING (public.owns_learner(learner_id)) WITH CHECK (public.owns_learner(learner_id));

-- GENERATED CONTENT CACHE
CREATE TABLE public.generated_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  learner_id uuid REFERENCES public.learners(id) ON DELETE CASCADE,
  type content_type NOT NULL,
  cache_key text NOT NULL,
  allowed_gpc_ids uuid[] NOT NULL DEFAULT '{}',
  content_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cache_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_content TO authenticated;
GRANT ALL ON public.generated_content TO service_role;
ALTER TABLE public.generated_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own generated content or global" ON public.generated_content FOR SELECT TO authenticated
  USING (learner_id IS NULL OR public.owns_learner(learner_id));
CREATE POLICY "insert generated content" ON public.generated_content FOR INSERT TO authenticated
  WITH CHECK (learner_id IS NULL OR public.owns_learner(learner_id));

-- REWARDS
CREATE TABLE public.rewards (
  learner_id uuid PRIMARY KEY REFERENCES public.learners(id) ON DELETE CASCADE,
  stars int NOT NULL DEFAULT 0,
  current_streak_days int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  last_session_date date,
  badges_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rewards TO authenticated;
GRANT ALL ON public.rewards TO service_role;
ALTER TABLE public.rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rewards" ON public.rewards FOR ALL TO authenticated
  USING (public.owns_learner(learner_id)) WITH CHECK (public.owns_learner(learner_id));
CREATE TRIGGER trg_rewards_updated BEFORE UPDATE ON public.rewards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create rewards + seed learner status rows when a learner is created
CREATE OR REPLACE FUNCTION public.handle_new_learner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.rewards (learner_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.learner_gpc_status (learner_id, gpc_id)
    SELECT NEW.id, g.id FROM public.gpcs g ON CONFLICT DO NOTHING;
  INSERT INTO public.learner_heart_word_status (learner_id, heart_word_id)
    SELECT NEW.id, h.id FROM public.heart_words h ON CONFLICT DO NOTHING;
  INSERT INTO public.learner_interference_status (learner_id, interference_id)
    SELECT NEW.id, i.id FROM public.interference_items i ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_on_new_learner AFTER INSERT ON public.learners
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_learner();

-- SEED GPCs
INSERT INTO public.gpcs (grapheme, sound_label, phase, order_index, type, example_word) VALUES
('s','/s/ as in sun',1,1,'single','sun'),
('a','short a as in cat',1,2,'single','cat'),
('t','/t/ as in top',1,3,'single','top'),
('p','/p/ as in pig',1,4,'single','pig'),
('i','short i as in sit',1,5,'single','sit'),
('n','/n/ as in net',1,6,'single','net'),
('m','/m/ as in map',2,7,'single','map'),
('d','/d/ as in dog',2,8,'single','dog'),
('g','hard g as in got',2,9,'single','got'),
('o','short o as in hot',2,10,'single','hot'),
('c','/k/ as in cat',2,11,'single','cat'),
('k','/k/ as in kit',2,12,'single','kit'),
('ck','/k/ as in duck',3,13,'digraph','duck'),
('e','short e as in bed',3,14,'single','bed'),
('u','short u as in cup',3,15,'single','cup'),
('r','/r/ as in run',3,16,'single','run'),
('h','/h/ as in hat',4,17,'single','hat'),
('b','/b/ as in bat',4,18,'single','bat'),
('f','/f/ as in fan',4,19,'single','fan'),
('l','/l/ as in log',4,20,'single','log'),
('j','/j/ as in jam',5,21,'single','jam'),
('v','/v/ as in van',5,22,'single','van'),
('w','/w/ as in wet',5,23,'single','wet'),
('x','/ks/ as in box',5,24,'single','box'),
('y','consonant y as in yes',5,25,'single','yes'),
('z','buzzy z as in zip',5,26,'single','zip'),
('qu','/kw/ as in queen',5,27,'digraph','queen'),
('sh','/sh/ as in ship',6,28,'digraph','ship'),
('ch','/ch/ as in chip',6,29,'digraph','chip'),
('th','/th/ as in think',6,30,'digraph','think'),
('ng','/ng/ as in ring',6,31,'digraph','ring'),
('nk','/nk/ as in pink',6,32,'digraph','pink'),
('ai','/ay/ as in rain',7,33,'vowel_team','rain'),
('ee','/ee/ as in see',7,34,'vowel_team','see'),
('igh','long i as in night',7,35,'vowel_team','night'),
('oa','long o as in boat',7,36,'vowel_team','boat'),
('oo','/oo/ as in moon',7,37,'vowel_team','moon'),
('ar','/ar/ as in car',7,38,'vowel_team','car'),
('or','/or/ as in for',7,39,'vowel_team','for'),
('ur','/ur/ as in fur',7,40,'vowel_team','fur'),
('ow','/ow/ as in cow',7,41,'vowel_team','cow'),
('oi','/oi/ as in coin',7,42,'vowel_team','coin'),
('er','/er/ as in her',7,43,'vowel_team','her'),
('a_e','long a as in cake',8,44,'split_digraph','cake'),
('e_e','long e as in these',8,45,'split_digraph','these'),
('i_e','long i as in bike',8,46,'split_digraph','bike'),
('o_e','long o as in home',8,47,'split_digraph','home'),
('u_e','long u as in tune',8,48,'split_digraph','tune');

-- SEED HEART WORDS
INSERT INTO public.heart_words (word, order_index) VALUES
('the',1),('to',2),('I',3),('no',4),('go',5),('into',6),('he',7),('she',8),('we',9),('me',10),
('be',11),('was',12),('you',13),('they',14),('all',15),('are',16),('my',17),('her',18),('said',19),('so',20),
('have',21),('like',22),('some',23),('come',24),('there',25),('little',26),('one',27),('do',28),('when',29),('what',30);

-- SEED INTERFERENCE
INSERT INTO public.interference_items (grapheme, swedish_value, english_value, note, example_word) VALUES
('i','ee','short i as in sit','In Swedish "i" says /ee/. In English it says short i.','sit'),
('j','y','/j/ as in jam','In Swedish "j" says /y/. In English it says /j/.','jam'),
('o','oo','short o as in hot','In Swedish "o" often says /oo/. In English short o says /o/.','hot'),
('e','eh/ay','short e as in bed','Swedish e can drift to /ay/. In English short e says /e/.','bed'),
('a','ah','short a as in cat','Swedish a is /ah/. English short a says /a/.','cat'),
('u','fronted u','short u as in cup','Swedish u is fronted. English short u says /u/.','cup'),
('y','rounded vowel','consonant y as in yes','In Swedish y is a vowel. In English at the start of a word it says /y/.','yes'),
('g','softens to y before e/i/y','hard g as in got','Swedish g softens before e/i/y. English g stays hard here.','got'),
('w','rare, like v','/w/ as in wet','Swedish rarely uses w and pronounces it like v. English w is /w/.','wet'),
('z','like s','buzzy z as in zip','In Swedish z is like /s/. In English z is a buzzy /z/.','zip'),
('th','n/a in Swedish','th as in think/this','Swedish has no th sound. English th is a tongue-between-teeth sound.','think');
