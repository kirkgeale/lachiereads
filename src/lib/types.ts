export type Outcome = "got_it" | "self_corrected" | "prompted" | "missed";
export type ItemStatus = "not_started" | "learning" | "practising" | "secure";
export type InterferenceStatus = "still_confuses" | "resolving" | "secure";
export type SessionItemType = "gpc" | "heart_word" | "decodable_word" | "math_skill" | "math_fact";
export type ContentType = "word_list" | "sentence" | "story" | "game_words" | "pseudowords";
export type GpcType = "single" | "digraph" | "split_digraph" | "vowel_team";

export type SessionStage =
  | "intro"
  | "warmup"
  | "target"
  | "guided"
  | "write"
  | "blend"
  | "practice"
  | "repetition"
  | "challenge"
  | "sentence"
  | "story"
  | "interference"
  | "game"
  | "recap"
  | "wrapup";

export interface Gpc {
  id: string;
  grapheme: string;
  sound_label: string;
  phase: number;
  order_index: number;
  type: GpcType;
  example_word: string;
}

export interface HeartWord {
  id: string;
  word: string;
  order_index: number;
}

export interface InterferenceItem {
  id: string;
  grapheme: string;
  swedish_value: string;
  english_value: string;
  note: string | null;
  example_word: string;
}

export interface StageIntro {
  title: string;
  guidance: string; // one-line parent prompt: what to model / how to lead
}

export interface SessionCard {
  key: string;
  item_type: SessionItemType;
  item_ref: string; // gpc id | heart_word id | word string
  display: string; // the text to show the child
  sound_label?: string;
  example_word?: string;
  interference?: InterferenceItem | null;
  stage: SessionStage;
  stage_intro?: StageIntro; // parent-facing guidance shown on the first card of a stage
  meta?: Record<string, string | number | boolean | null | string[]>;
}

export interface SessionPlan {
  session_id: string;
  learner_id: string;
  cards: SessionCard[];
  target_gpc_id?: string;
}

export interface QueuedEvent {
  card_key: string;
  item_type: SessionItemType;
  item_ref: string;
  outcome: Outcome;
}
