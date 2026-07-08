ALTER TABLE public.gpcs ADD COLUMN IF NOT EXISTS assessment_word text;

UPDATE public.gpcs SET assessment_word = v.aw FROM (VALUES
  ('s','sat'),('a','ran'),('t','tap'),('p','pop'),('i','pin'),('n','nap'),
  ('m','mud'),('d','dip'),('g','gap'),('o','pod'),('c','cot'),('k','kid'),
  ('ck','sock'),('e','peg'),('u','bug'),('r','rip'),('h','hut'),('b','bit'),
  ('f','fig'),('l','lip'),('j','jet'),('v','vet'),('w','web'),('x','fox'),
  ('y','yak'),('z','zap'),('qu','quiz'),('sh','shed'),('ch','chin'),
  ('th','moth'),('ng','song'),('nk','sink'),('ai','sail'),('ee','feet'),
  ('igh','light'),('oa','goat'),('oo','food'),('ar','star'),('or','fork'),
  ('ur','burn'),('ow','down'),('oi','boil'),('er','fern'),('a_e','gate'),
  ('e_e','eve'),('i_e','time'),('o_e','bone'),('u_e','cube')
) AS v(gr, aw) WHERE public.gpcs.grapheme = v.gr;