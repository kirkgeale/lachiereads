// Helper used by session.functions.ts to invoke the generate-content edge function
// with caching. Runs on the server (server function context) — receives the user's
// supabase client (RLS active) so cache reads/inserts go through the user's session.

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateContent, extractWords } from "./decodable";

interface GenArgs {
  supabase: SupabaseClient;
  learner_id: string;
  type: "word_list" | "sentence" | "story" | "game_words" | "pseudowords";
  allowedGraphemes: string[];
  allowedGpcIds: string[];
  knownHeartWords: string[];
}

function makeCacheKey(a: GenArgs): string {
  const gs = [...a.allowedGraphemes].sort().join(",");
  const hs = [...a.knownHeartWords].sort().join(",");
  return `${a.type}::${gs}::${hs}`;
}

// Fallback: assemble simple decodable words from the allowed set
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

  // 1) cache lookup
  const { data: cached } = await a.supabase
    .from("generated_content")
    .select("content_json")
    .eq("cache_key", cache_key)
    .maybeSingle();
  if (cached?.content_json) return cached.content_json;

  // 2) call edge function
  let content: any = null;
  try {
    const { data, error } = await a.supabase.functions.invoke("generate-content", {
      body: {
        type: a.type,
        allowed_graphemes: a.allowedGraphemes,
        known_heart_words: a.knownHeartWords,
      },
    });
    if (error) throw error;
    content = data;
  } catch (err) {
    console.error("[generate-content edge] error", err);
  }

  // 3) validate decodability
  let ok = false;
  if (content) {
    const words: string[] = [];
    if (content.words) words.push(...content.words);
    if (content.sentence) words.push(...extractWords(content.sentence));
    if (content.story) words.push(...extractWords(content.story));
    const v = validateContent(words, a.allowedGraphemes, a.knownHeartWords);
    ok = v.ok;
    if (!ok) console.warn("[generate-content] not fully decodable, offenders:", v.offenders);
  }

  // 4) fallback
  if (!content || !ok) {
    if (a.type === "word_list" || a.type === "game_words" || a.type === "pseudowords") {
      content = { words: fallbackWordList(a.allowedGraphemes, a.knownHeartWords) };
    } else if (a.type === "sentence") {
      const w = fallbackWordList(a.allowedGraphemes, a.knownHeartWords);
      content = { sentence: w.slice(0, 3).join(" ") + "." };
    } else {
      content = { story: fallbackWordList(a.allowedGraphemes, a.knownHeartWords).join(" ") + "." };
    }
  }

  // 5) cache
  await a.supabase
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

  return content;
}
