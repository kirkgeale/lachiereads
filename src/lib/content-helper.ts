// Helper used by session.functions.ts to invoke the generate-content edge function
// with caching. Runs on the server (server function context) — receives the user's
// supabase client (RLS active) so cache reads/inserts go through the user's session.

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateContent, extractWords } from "./decodable";

export interface InterferencePair {
  grapheme: string;
  swedish_value: string;
  english_value: string;
}

interface GenArgs {
  supabase: SupabaseClient;
  learner_id: string;
  type: "word_list" | "sentence" | "story" | "game_words" | "pseudowords" | "lesson_bundle";
  allowedGraphemes: string[];
  allowedGpcIds: string[];
  knownHeartWords: string[];
  ageYears?: number | null;
  currentPhase?: number | null;
  targetGrapheme?: string | null;
  targetSoundLabel?: string | null;
  recentMisses?: string[];
  interferencePairs?: InterferencePair[];
  strengths?: string[];
  challenges?: string[];
  freshnessSalt?: string;
  variant?: string;
  interests?: string | null;
  parentObservations?: string[];
  count?: number | null;
}

function makeCacheKey(a: GenArgs): string {
  const gs = [...a.allowedGraphemes].sort().join(",");
  const hs = [...a.knownHeartWords].sort().join(",");
  const t = a.targetGrapheme ?? "";
  const m = (a.recentMisses ?? []).slice(0, 6).sort().join(",");
  const s = (a.strengths ?? []).slice(0, 8).sort().join(",");
  const c = (a.challenges ?? []).slice(0, 8).sort().join(",");
  const f = a.freshnessSalt ?? "";
  const v = a.variant ?? "";
  const i = (a.interests ?? "").trim().toLowerCase();
  const p = (a.parentObservations ?? []).slice(0, 3).join("|");
  const n = a.count ?? "";
  // Prefix learner_id so two learners never share a cache row.
  return `L=${a.learner_id}::${a.type}::${gs}::${hs}::t=${t}::m=${m}::s=${s}::c=${c}::f=${f}::v=${v}::i=${i}::p=${p}::n=${n}`;
}

function fallbackWordList(allowedGraphemes: string[], known: string[]): string[] {
  const singles = allowedGraphemes.filter((g) => g.length === 1 && !g.includes("_"));
  const vowels = singles.filter((g) => "aeiou".includes(g));
  const cons = singles.filter((g) => !"aeiou".includes(g));
  const words = new Set<string>();
  for (const c1 of cons) {
    for (const v of vowels) {
      for (const c2 of cons) {
        const w = c1 + v + c2;
        if (w.length === 3) words.add(w);
        if (words.size >= 8) break;
      }
      if (words.size >= 8) break;
    }
    if (words.size >= 8) break;
  }
  const list = Array.from(words);
  if (list.length === 0 && known.length) return known.slice(0, 4);
  return list.slice(0, 6);
}

export async function generateContentInternal(a: GenArgs): Promise<any> {
  const cache_key = makeCacheKey(a);

  const { data: cached } = await a.supabase
    .from("generated_content")
    .select("content_json")
    .eq("cache_key", cache_key)
    .maybeSingle();
  if (cached?.content_json) return cached.content_json;

  const invokeGen = async () => {
    const { data, error } = await a.supabase.functions.invoke("generate-content", {
      body: {
        type: a.type,
        allowed_graphemes: a.allowedGraphemes,
        known_heart_words: a.knownHeartWords,
        age_years: a.ageYears ?? null,
        current_phase: a.currentPhase ?? null,
        target_grapheme: a.targetGrapheme ?? null,
        target_sound_label: a.targetSoundLabel ?? null,
        recent_misses: a.recentMisses ?? [],
        interference_pairs: a.interferencePairs ?? [],
        strengths: a.strengths ?? [],
        challenges: a.challenges ?? [],
        interests: a.interests ?? null,
        parent_observations: a.parentObservations ?? [],
        count: a.count ?? null,
      },
    });
    if (error) throw error;
    return data;
  };

  let content: any = null;
  try {
    content = await invokeGen();
  } catch (err) {
    console.error("[generate-content edge] error", err);
  }

  // Server-side decodability validation
  let ok = false;
  if (content && a.type !== "lesson_bundle") {
    const words: string[] = [];
    if (content.words) words.push(...content.words);
    if (content.sentence) words.push(...extractWords(content.sentence));
    if (content.story) words.push(...extractWords(content.story));
    const v = validateContent(words, a.allowedGraphemes, a.knownHeartWords);
    ok = v.ok;
    if (!ok) console.warn("[generate-content] not fully decodable, offenders:", v.offenders);
  } else if (content && a.type === "lesson_bundle") {
    // Filter lists in-place; regenerate sentence/story once if undecodable; drop if still bad.
    const filterList = (arr: any): string[] => {
      if (!Array.isArray(arr)) return [];
      const kept: string[] = [];
      const dropped: string[] = [];
      for (const w of arr) {
        if (typeof w !== "string") continue;
        const clean = w.trim();
        if (!clean) continue;
        const v = validateContent([clean], a.allowedGraphemes, a.knownHeartWords);
        if (v.ok) kept.push(clean); else dropped.push(clean);
      }
      if (dropped.length) console.warn("[lesson_bundle] dropped undecodable:", dropped);
      return kept;
    };
    content.blend_words = filterList(content.blend_words);
    content.practice_words = filterList(content.practice_words);
    content.flashcard_decodable = filterList(content.flashcard_decodable);
    content.guided_words = filterList(content.guided_words);
    if (Array.isArray(content.focus?.examples)) {
      content.focus.examples = filterList(content.focus.examples);
    }
    // challenge_item / recap_item: drop if undecodable
    const oneWordOk = (w: any) =>
      typeof w === "string" && w.trim() &&
      validateContent(extractWords(w), a.allowedGraphemes, a.knownHeartWords).ok;
    if (content.challenge_item && typeof content.challenge_item === "object") {
      if (!oneWordOk(content.challenge_item.word)) {
        console.warn("[lesson_bundle] dropping challenge_item");
        content.challenge_item = null;
      }
    }
    if (!oneWordOk(content.recap_item)) {
      console.warn("[lesson_bundle] dropping recap_item");
      content.recap_item = null;
    }

    const sentenceOk = (s: any) => typeof s === "string" && s.trim() &&
      validateContent(extractWords(s), a.allowedGraphemes, a.knownHeartWords).ok;

    if (!sentenceOk(content.sentence) || !sentenceOk(content.story)) {
      console.warn("[lesson_bundle] sentence/story undecodable — regenerating once");
      try {
        const retry = await invokeGen();
        if (retry) {
          if (sentenceOk(retry.sentence)) content.sentence = retry.sentence;
          if (sentenceOk(retry.story)) content.story = retry.story;
        }
      } catch (e) {
        console.error("[lesson_bundle] regen failed", e);
      }
    }
    if (!sentenceOk(content.sentence)) { console.warn("[lesson_bundle] dropping sentence"); content.sentence = null; }
    if (!sentenceOk(content.story)) { console.warn("[lesson_bundle] dropping story"); content.story = null; }
    ok = true;
  }

  if (!content || !ok) {
    if (a.type === "word_list" || a.type === "game_words" || a.type === "pseudowords") {
      content = { words: fallbackWordList(a.allowedGraphemes, a.knownHeartWords) };
    } else if (a.type === "sentence") {
      const w = fallbackWordList(a.allowedGraphemes, a.knownHeartWords);
      content = { sentence: w.slice(0, 3).join(" ") + "." };
    } else if (a.type === "story") {
      content = { story: fallbackWordList(a.allowedGraphemes, a.knownHeartWords).join(" ") + "." };
    } else {
      // lesson_bundle fallback
      const w = fallbackWordList(a.allowedGraphemes, a.knownHeartWords);
      content = {
        focus: {
          title: "Practice",
          concept: "General reading practice with sounds we already know.",
          parent_intro: "We'll warm up with a few sounds, then read some words together. Take it slow — sound out, then blend.",
          examples: w.slice(0, 3),
        },
        blend_words: w.slice(0, 5),
        practice_words: w.slice(0, 8),
        sentence: w.slice(0, 3).join(" ") + ".",
        story: w.slice(0, 6).join(" ") + ".",
        flashcard_decodable: w.slice(0, 8),
      };
    }
  }

  const { error: upsertErr } = await a.supabase
    .from("generated_content")
    .upsert(
      {
        learner_id: a.learner_id,
        type: a.type,
        cache_key,
        allowed_gpc_ids: a.allowedGpcIds,
        content_json: content,
      },
      { onConflict: "cache_key" },
    );
  if (upsertErr) console.error("[generate-content] cache upsert failed", upsertErr);

  return content;
}
