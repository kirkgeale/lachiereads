import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { applyOutcome } from "./srs";
import type { SessionCard, SessionPlan, QueuedEvent, Outcome } from "./types";
import { generateContentInternal } from "./content-helper";

const today = () => new Date().toISOString().slice(0, 10);

// Build a session plan: warmup (due), target (learning/next), practice (AI), game, wrapup marker
export const startSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string }) => z.object({ learner_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<SessionPlan> => {
    const { supabase } = context;
    const t = today();

    // 1) Warm-up: 3-5 due items (mix gpc + heart word)
    const { data: dueGpcs } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, leitner_box, status, gpcs(grapheme, sound_label, example_word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(4);

    const { data: dueHw } = await supabase
      .from("learner_heart_word_status")
      .select("heart_word_id, leitner_box, status, heart_words(word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(3);

    const warmup: SessionCard[] = [];
    for (const g of dueGpcs ?? []) {
      warmup.push({
        key: `w-g-${g.gpc_id}`,
        item_type: "gpc",
        item_ref: g.gpc_id,
        display: (g as any).gpcs?.grapheme ?? "",
        sound_label: (g as any).gpcs?.sound_label,
        example_word: (g as any).gpcs?.example_word,
        stage: "warmup",
      });
    }
    for (const h of dueHw ?? []) {
      warmup.push({
        key: `w-h-${h.heart_word_id}`,
        item_type: "heart_word",
        item_ref: h.heart_word_id,
        display: (h as any).heart_words?.word ?? "",
        stage: "warmup",
      });
    }
    warmup.splice(5); // cap at 5

    // 2) Target: pick a "learning" GPC, else the next "not_started" by order_index
    const { data: learningGpc } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, gpcs(id, grapheme, sound_label, example_word, order_index)")
      .eq("learner_id", data.learner_id)
      .eq("status", "learning")
      .order("gpcs(order_index)", { ascending: true })
      .limit(1)
      .maybeSingle();

    let targetGpc = learningGpc
      ? {
          id: learningGpc.gpc_id,
          grapheme: (learningGpc as any).gpcs.grapheme,
          sound_label: (learningGpc as any).gpcs.sound_label,
          example_word: (learningGpc as any).gpcs.example_word,
        }
      : null;

    if (!targetGpc) {
      const { data: nextGpc } = await supabase
        .from("learner_gpc_status")
        .select("gpc_id, gpcs(id, grapheme, sound_label, example_word, order_index)")
        .eq("learner_id", data.learner_id)
        .eq("status", "not_started")
        .order("gpcs(order_index)", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (nextGpc) {
        // promote it to "learning"
        await supabase
          .from("learner_gpc_status")
          .update({ status: "learning" })
          .eq("learner_id", data.learner_id)
          .eq("gpc_id", nextGpc.gpc_id);
        targetGpc = {
          id: nextGpc.gpc_id,
          grapheme: (nextGpc as any).gpcs.grapheme,
          sound_label: (nextGpc as any).gpcs.sound_label,
          example_word: (nextGpc as any).gpcs.example_word,
        };
      }
    }

    const targetCards: SessionCard[] = [];
    if (targetGpc) {
      // interference?
      const { data: interference } = await supabase
        .from("interference_items")
        .select("*")
        .eq("grapheme", targetGpc.grapheme)
        .maybeSingle();

      targetCards.push({
        key: `t-${targetGpc.id}`,
        item_type: "gpc",
        item_ref: targetGpc.id,
        display: targetGpc.grapheme,
        sound_label: targetGpc.sound_label,
        example_word: targetGpc.example_word,
        interference: interference ?? null,
        stage: "target",
      });
    }

    // 3) Practice: AI content restricted to reached graphemes + known heart words,
    //    personalised with age, target GPC, recent misses, and interference.
    const { data: reachedGpcs } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, gpcs(id, grapheme)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");

    const allowedGraphemes = (reachedGpcs ?? []).map((r: any) => r.gpcs.grapheme as string);
    const allowedGpcIds = (reachedGpcs ?? []).map((r: any) => r.gpc_id as string);

    const { data: knownHwRows } = await supabase
      .from("learner_heart_word_status")
      .select("heart_words(word)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started");
    const knownHeartWords = (knownHwRows ?? []).map((r: any) => r.heart_words.word as string);

    const { data: learnerRow } = await supabase
      .from("learners")
      .select("birthdate")
      .eq("id", data.learner_id)
      .maybeSingle();
    const ageYears = learnerRow?.birthdate
      ? Math.floor((Date.now() - new Date(learnerRow.birthdate).getTime()) / (365.25 * 86400000))
      : null;

    const { data: interferenceRows } = await supabase
      .from("interference_items")
      .select("grapheme, swedish_value, english_value");

    // Recent misses (last ~30 events)
    const { data: recentEvents } = await supabase
      .from("session_events")
      .select("item_ref, outcome, sessions!inner(learner_id, created_at)")
      .eq("sessions.learner_id", data.learner_id)
      .in("outcome", ["missed", "hesitated"])
      .order("created_at", { ascending: false, referencedTable: "sessions" as any })
      .limit(30);
    const recentMisses = Array.from(
      new Set((recentEvents ?? []).map((r: any) => r.item_ref).filter(Boolean)),
    ).slice(0, 8);

    const practiceCards: SessionCard[] = [];
    if (allowedGraphemes.length > 0) {
      try {
        const wordListRes = await generateContentInternal({
          supabase,
          learner_id: data.learner_id,
          type: "word_list",
          allowedGraphemes,
          allowedGpcIds,
          knownHeartWords,
          ageYears,
          targetGrapheme: targetGpc?.grapheme ?? null,
          targetSoundLabel: targetGpc?.sound_label ?? null,
          recentMisses,
          interferencePairs: interferenceRows ?? [],
        });
        const words: string[] = wordListRes.words ?? [];
        for (const w of words.slice(0, 6)) {
          practiceCards.push({
            key: `p-w-${w}`,
            item_type: "decodable_word",
            item_ref: w,
            display: w,
            stage: "practice",
          });
        }

        const sentenceRes = await generateContentInternal({
          supabase,
          learner_id: data.learner_id,
          type: "sentence",
          allowedGraphemes,
          allowedGpcIds,
          knownHeartWords,
          ageYears,
          targetGrapheme: targetGpc?.grapheme ?? null,
          targetSoundLabel: targetGpc?.sound_label ?? null,
          recentMisses,
          interferencePairs: interferenceRows ?? [],
        });
        const sentence: string = sentenceRes.sentence ?? "";
        if (sentence) {
          practiceCards.push({
            key: `p-s`,
            item_type: "decodable_word",
            item_ref: sentence,
            display: sentence,
            stage: "practice",
            meta: { kind: "sentence" },
          });
        }
      } catch (err) {
        console.error("[startSession] practice content failed", err);
      }
    }

    // 4) Game: pick 3 taught GPCs, ask "tap the sound for ___"
    const gameSourcePool = (reachedGpcs ?? []).slice(0, 12);
    const shuffled = [...gameSourcePool].sort(() => Math.random() - 0.5);
    const gameCards: SessionCard[] = shuffled.slice(0, 3).map((r: any) => ({
      key: `g-${r.gpc_id}`,
      item_type: "gpc",
      item_ref: r.gpc_id,
      display: r.gpcs.grapheme,
      stage: "game",
      meta: { kind: "quick_game" },
    }));

    // 5) Wrap-up marker card
    const wrapup: SessionCard[] = [
      { key: "wrap", item_type: "gpc", item_ref: "", display: "", stage: "wrapup" },
    ];

    const cards = [...warmup, ...targetCards, ...practiceCards, ...gameCards, ...wrapup];

    // Create session row
    const { data: session, error: se } = await supabase
      .from("sessions")
      .insert({ learner_id: data.learner_id, plan_json: { cards } as any })
      .select("id")
      .single();
    if (se) throw new Error(se.message);

    return {
      session_id: session.id,
      learner_id: data.learner_id,
      cards,
      target_gpc_id: targetGpc?.id,
    };
  });

// Save the outcomes, run SRS updates, update rewards
export const saveSessionEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { session_id: string; learner_id: string; events: QueuedEvent[]; duration_seconds: number; parent_notes?: string | null }) =>
    z
      .object({
        session_id: z.string().uuid(),
        learner_id: z.string().uuid(),
        events: z.array(
          z.object({
            card_key: z.string(),
            item_type: z.enum(["gpc", "heart_word", "decodable_word"]),
            item_ref: z.string(),
            outcome: z.enum(["got_it", "hesitated", "missed"]),
          }),
        ),
        duration_seconds: z.number().int().nonnegative(),
        parent_notes: z.string().nullable().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Insert events
    if (data.events.length) {
      const rows = data.events.map((e) => ({
        session_id: data.session_id,
        item_type: e.item_type,
        item_ref: e.item_ref,
        outcome: e.outcome,
      }));
      const { error } = await supabase.from("session_events").insert(rows);
      if (error) throw new Error(error.message);
    }

    // Update session
    await supabase
      .from("sessions")
      .update({ duration_seconds: data.duration_seconds, parent_notes: data.parent_notes ?? null })
      .eq("id", data.session_id);

    const newlySecureGpcIds: string[] = [];

    // Apply SRS per unique gpc/heart_word item
    const gpcEvents = data.events.filter((e) => e.item_type === "gpc" && e.item_ref);
    const hwEvents = data.events.filter((e) => e.item_type === "heart_word" && e.item_ref);

    for (const ev of gpcEvents) {
      const { data: row } = await supabase
        .from("learner_gpc_status")
        .select("leitner_box, correct_streak, status")
        .eq("learner_id", data.learner_id)
        .eq("gpc_id", ev.item_ref)
        .maybeSingle();
      if (!row) continue;
      const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
      await supabase
        .from("learner_gpc_status")
        .update({
          leitner_box: res.box,
          correct_streak: res.streak,
          status: res.status,
          next_due_date: res.next_due_date,
          last_seen: res.last_seen,
        })
        .eq("learner_id", data.learner_id)
        .eq("gpc_id", ev.item_ref);
      if (res.status === "secure" && row.status !== "secure") newlySecureGpcIds.push(ev.item_ref);
    }
    for (const ev of hwEvents) {
      const { data: row } = await supabase
        .from("learner_heart_word_status")
        .select("leitner_box, correct_streak")
        .eq("learner_id", data.learner_id)
        .eq("heart_word_id", ev.item_ref)
        .maybeSingle();
      if (!row) continue;
      const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
      await supabase
        .from("learner_heart_word_status")
        .update({
          leitner_box: res.box,
          correct_streak: res.streak,
          status: res.status,
          next_due_date: res.next_due_date,
          last_seen: res.last_seen,
        })
        .eq("learner_id", data.learner_id)
        .eq("heart_word_id", ev.item_ref);
    }

    // Rewards: +1 star per got_it, streak update
    const stars = data.events.filter((e) => e.outcome === "got_it").length;
    const t = today();
    const { data: r } = await supabase
      .from("rewards")
      .select("stars, current_streak_days, longest_streak, last_session_date")
      .eq("learner_id", data.learner_id)
      .maybeSingle();
    let current = r?.current_streak_days ?? 0;
    const last = r?.last_session_date;
    if (last === t) {
      // same day, no change
    } else if (last) {
      const lastDate = new Date(last);
      const todayDate = new Date(t);
      const diffDays = Math.round((todayDate.getTime() - lastDate.getTime()) / 86400000);
      current = diffDays === 1 ? current + 1 : 1;
    } else {
      current = 1;
    }
    const longest = Math.max(r?.longest_streak ?? 0, current);
    await supabase
      .from("rewards")
      .update({
        stars: (r?.stars ?? 0) + stars,
        current_streak_days: current,
        longest_streak: longest,
        last_session_date: t,
      })
      .eq("learner_id", data.learner_id);

    return { ok: true, newly_secure_gpc_ids: newlySecureGpcIds, stars_awarded: stars };
  });

// FLASHCARDS DECK
export const buildFlashcardDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; size?: number }) =>
    z.object({ learner_id: z.string().uuid(), size: z.number().int().min(3).max(30).optional() }).parse(d),
  )
  .handler(async ({ data, context }): Promise<SessionCard[]> => {
    const { supabase } = context;
    const size = data.size ?? 20;
    const t = today();

    // 1) Preferred: due items
    const { data: dueGpcs } = await supabase
      .from("learner_gpc_status")
      .select("gpc_id, leitner_box, next_due_date, status, gpcs(grapheme, sound_label, example_word, order_index)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(size);

    const { data: dueHws } = await supabase
      .from("learner_heart_word_status")
      .select("heart_word_id, leitner_box, next_due_date, status, heart_words(word, order_index)")
      .eq("learner_id", data.learner_id)
      .neq("status", "not_started")
      .lte("next_due_date", t)
      .order("next_due_date", { ascending: true })
      .limit(size);

    let gpcs: any[] = dueGpcs ?? [];
    let hws: any[] = dueHws ?? [];

    // 2) Fallback: pick level-appropriate active items even if not due
    if (gpcs.length + hws.length < Math.min(size, 6)) {
      // Prioritise learning + practising, then a handful of secure for review
      const { data: activeGpcs } = await supabase
        .from("learner_gpc_status")
        .select("gpc_id, leitner_box, status, gpcs(grapheme, sound_label, example_word, order_index)")
        .eq("learner_id", data.learner_id)
        .neq("status", "not_started")
        .order("leitner_box", { ascending: true })
        .limit(size * 2);
      const { data: activeHws } = await supabase
        .from("learner_heart_word_status")
        .select("heart_word_id, leitner_box, status, heart_words(word, order_index)")
        .eq("learner_id", data.learner_id)
        .neq("status", "not_started")
        .order("leitner_box", { ascending: true })
        .limit(size);
      const seenG = new Set(gpcs.map((g) => g.gpc_id));
      const seenH = new Set(hws.map((h) => h.heart_word_id));
      const extraG = (activeGpcs ?? []).filter((g: any) => !seenG.has(g.gpc_id));
      const extraH = (activeHws ?? []).filter((h: any) => !seenH.has(h.heart_word_id));
      // Weight: keep learning/practising first, add secure as light review
      const rank = (s: string) => (s === "learning" ? 0 : s === "practising" ? 1 : 2);
      extraG.sort((a: any, b: any) => rank(a.status) - rank(b.status));
      extraH.sort((a: any, b: any) => rank(a.status) - rank(b.status));
      gpcs = [...gpcs, ...extraG].slice(0, size);
      hws = [...hws, ...extraH].slice(0, Math.max(2, Math.floor(size / 3)));
    }

    const cards: SessionCard[] = [];
    for (const g of gpcs) {
      cards.push({
        key: `fc-g-${g.gpc_id}`,
        item_type: "gpc",
        item_ref: g.gpc_id,
        display: (g as any).gpcs?.grapheme ?? "",
        sound_label: (g as any).gpcs?.sound_label,
        example_word: (g as any).gpcs?.example_word,
        stage: "warmup",
      });
    }
    for (const h of hws) {
      cards.push({
        key: `fc-h-${h.heart_word_id}`,
        item_type: "heart_word",
        item_ref: h.heart_word_id,
        display: (h as any).heart_words?.word ?? "",
        stage: "warmup",
      });
    }
    return cards.sort(() => Math.random() - 0.5).slice(0, size);
  });

export const saveFlashcardEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { learner_id: string; events: QueuedEvent[] }) =>
    z
      .object({
        learner_id: z.string().uuid(),
        events: z.array(
          z.object({
            card_key: z.string(),
            item_type: z.enum(["gpc", "heart_word", "decodable_word"]),
            item_ref: z.string(),
            outcome: z.enum(["got_it", "hesitated", "missed"]),
          }),
        ),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // create a synthetic session for record-keeping
    const { supabase } = context;
    const { data: session } = await supabase
      .from("sessions")
      .insert({ learner_id: data.learner_id, plan_json: { kind: "flashcards" }, duration_seconds: 0 })
      .select("id")
      .single();
    if (!session) throw new Error("Failed to create flashcards session");

    if (data.events.length) {
      await supabase.from("session_events").insert(
        data.events.map((e) => ({
          session_id: session.id,
          item_type: e.item_type,
          item_ref: e.item_ref,
          outcome: e.outcome,
        })),
      );
    }

    const newlySecure: string[] = [];
    for (const ev of data.events) {
      if (ev.item_type === "gpc") {
        const { data: row } = await supabase
          .from("learner_gpc_status")
          .select("leitner_box, correct_streak, status")
          .eq("learner_id", data.learner_id)
          .eq("gpc_id", ev.item_ref)
          .maybeSingle();
        if (!row) continue;
        const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
        await supabase
          .from("learner_gpc_status")
          .update({
            leitner_box: res.box,
            correct_streak: res.streak,
            status: res.status,
            next_due_date: res.next_due_date,
            last_seen: res.last_seen,
          })
          .eq("learner_id", data.learner_id)
          .eq("gpc_id", ev.item_ref);
        if (res.status === "secure" && row.status !== "secure") newlySecure.push(ev.item_ref);
      } else if (ev.item_type === "heart_word") {
        const { data: row } = await supabase
          .from("learner_heart_word_status")
          .select("leitner_box, correct_streak")
          .eq("learner_id", data.learner_id)
          .eq("heart_word_id", ev.item_ref)
          .maybeSingle();
        if (!row) continue;
        const res = applyOutcome({ box: row.leitner_box, streak: row.correct_streak, outcome: ev.outcome as Outcome });
        await supabase
          .from("learner_heart_word_status")
          .update({
            leitner_box: res.box,
            correct_streak: res.streak,
            status: res.status,
            next_due_date: res.next_due_date,
            last_seen: res.last_seen,
          })
          .eq("learner_id", data.learner_id)
          .eq("heart_word_id", ev.item_ref);
      }
    }

    // Stars
    const stars = data.events.filter((e) => e.outcome === "got_it").length;
    const { data: r } = await supabase
      .from("rewards")
      .select("stars")
      .eq("learner_id", data.learner_id)
      .maybeSingle();
    await supabase
      .from("rewards")
      .update({ stars: (r?.stars ?? 0) + stars })
      .eq("learner_id", data.learner_id);

    return { ok: true, newly_secure_gpc_ids: newlySecure, stars_awarded: stars };
  });
