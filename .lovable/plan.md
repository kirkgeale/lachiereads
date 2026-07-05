
# Reading Garden — Build Plan

A private, warm, parent-guided phonics app for a Swedish-schooled native English speaker learning to decode English. Human-in-the-loop (parent taps outcomes; no speech recognition). React + Tailwind on TanStack Start, Lovable Cloud (Supabase) for DB/auth/edge, Claude for decodable content generation.

## Two quick decisions before I build

1. **Claude model**: your spec says `claude-sonnet-5`, which isn't a released id. I'll put the model in one config constant and default to **`claude-sonnet-4-5`** (current Sonnet). You can change it in one place any time.
2. **Parent PIN**: I'll add a 4-digit PIN set on first parent login, stored hashed in a `parent_settings` row, gating the dashboard from the kid view. Login itself is email+password.

If either is wrong, tell me and I'll adjust before building.

## Design direction

Warm Waldorf-adjacent storybook: sage/moss, warm cream, muted terracotta, soft sky blue; rounded organic shapes; generous whitespace; large legible serif for display + humanist sans for body; OpenDyslexic toggle. No arcade colors, no bouncy animation — gentle fades and grow-ins only. Kid view = big tap targets, minimal chrome. Parent view = quiet dashboard.

## Build order (matches your spec)

1. Cloud + auth + learners + seeded phonics tables + RLS
2. SRS engine + guided session flow
3. Flashcards
4. `generate-content` edge function + cache
5. Parent dashboard (charts, phonics map, interference tracker)
6. Benchmark mode
7. Garden rewards + PWA + polish

## Data model

Tables exactly as specified: `learners`, `gpcs`, `learner_gpc_status`, `heart_words`, `learner_heart_word_status`, `interference_items`, `learner_interference_status`, `sessions`, `session_events`, `benchmarks`, `generated_content`, `rewards`. Plus `parent_settings` (parent_id, pin_hash, dyslexia_font, active_learner_id) and a `user_roles` table for parent role.

RLS: every learner-scoped table gates on `learner_id IN (SELECT id FROM learners WHERE parent_id = auth.uid())`. Seed tables (`gpcs`, `heart_words`, `interference_items`) are readable by any authenticated user, writable only by service role. GRANTs to `authenticated` on all user-facing tables.

Seed data inserted via migration exactly as listed in your spec (phases 1–8 GPCs, 30 heart words, 11 interference items).

## SRS engine (pure TypeScript, deterministic)

`src/lib/srs.ts` — pure function `applyOutcome(currentBox, outcome) → { newBox, nextDueDate, newStatus, streak }`. Intervals 1/2/4/8/16 days. Status: box 1–2 learning, box 3 practising, box 4–5 with recent "got it" secure. Used identically for GPCs and heart words. Called from a server function after each session save so all timestamp math is server-side.

## Routes

```
/auth                       email login
/                           kid home (garden + Start Session + Flashcards)
/session/$learnerId         guided session flow (5 stages)
/flashcards/$learnerId      due-deck tap-through
/parent                     PIN gate → dashboard
/parent/learners            add/edit learners
/parent/phonics/$learnerId  phonics map + manual overrides
/parent/interference/$id    interference tracker
/parent/sessions/$id        session history + detail
/parent/benchmark/$id       run + view benchmarks
```

Kid routes are top-level; `/parent/*` sits under `_authenticated/` and additionally requires PIN unlock held in sessionStorage for the tab.

## Guided session flow

Server fn `buildSessionPlan(learnerId)` returns a `plan_json` with 5 stages:
1. **Warm-up** — 3–5 due items from SRS across gpc/heart_word/decodable_word
2. **Target skill** — one `learning` GPC (or next `not_started`); if in `interference_items`, show contrast card
3. **Decodable practice** — words + one sentence/mini-story from `generate-content`, restricted to allowed GPCs
4. **Quick game** — "tap the word that says ___" using taught items
5. **Wrap-up** — stars, streak, parent note

Each item screen: large item, three big buttons "Got it / Hesitated / Missed". Taps queue locally, flushed to `session_events` at wrap-up, then a server fn runs SRS updates in one transaction.

## Flashcards

`buildFlashcardDeck(learnerId, size=10)` picks most-overdue items across all three types, weighted toward `learning`. Same three-button UI as session items. Same SRS write path.

## Edge function: `generate-content`

Supabase edge function (not a server fn — you asked for edge). Input: `{ learner_id, type, allowed_graphemes, known_heart_words }`. Calls Anthropic Messages API with `ANTHROPIC_API_KEY` and model from a single constant. System prompt enforces: only listed graphemes, only listed heart words, calm nature/animal/everyday themes, strict JSON output.

Flow:
1. Hash `(type, sorted allowed_graphemes, sorted heart_words)` → cache key
2. Look up in `generated_content` for this learner (or global if no learner-specific tuning); return if hit
3. Call Claude; validate every word is decodable by tokenising against allowed graphemes + heart words
4. On validation fail: retry once with a stricter reminder; if still failing, fall back to a templated word list built from allowed graphemes
5. Insert into `generated_content` and return

Frontend calls this via a thin server fn wrapper so the anon key never leaves the server.

## Parent dashboard

- **Progress**: Recharts line chart of secure-GPC count over time; flashcard retention (got_it / total per week); session streak from `rewards`
- **Phonics map**: grid of all GPCs in `order_index`, cell colored by status (not_started/learning/practising/secure), click to override
- **Interference tracker**: list with still_confuses/resolving/secure toggles
- **Session history**: table with date, duration, event counts, notes; drill-in shows every tapped event
- **Benchmark history**: trend of criterion-referenced scores (never percentiles)
- **Controls**: add/edit learners, start session, start benchmark, regenerate content, manual GPC status/order edits

## Benchmark mode

Parent-administered form with four sections: letter-sound check (forces i/j/o/e/a/u/y/g/w/z/th), real-word list (drawn from taught GPCs), pseudoword list (generated via edge fn with `type='pseudowords'`), and a short decodable passage. Parent enters correct counts; saved to `benchmarks.scores_json`. Trend view compares to prior benchmarks only.

## Kid view + garden rewards

Home screen shows the child's garden: an SVG scene where each secured GPC grows a plant/tree/flower (deterministic mapping GPC → plant kind, seeded by `order_index`). Gentle scale-in animation when a new secure lands after a session. Big "Start Session" and "Flashcards" buttons. `garden_theme` on learner picks palette variant (meadow/forest/coast).

## PWA

Manifest-only installability (per PWA skill): `public/manifest.webmanifest`, theme + icons, `apple-touch-icon`. No service worker (you don't need offline; adding one in Lovable preview breaks things).

## Technical section

- **Stack**: TanStack Start (existing), Tailwind v4, shadcn/ui for primitives, Recharts, Motion for React for the garden grow-in
- **Auth gate**: integration-managed `_authenticated/` layout for parent routes; kid routes public but require the parent to have signed in on this device (session persisted in localStorage — matches "personal family app")
- **Server fns**: `getLearners`, `startSession` (returns plan_json), `saveSessionEvents` (writes events + runs SRS + updates rewards + returns newly-secured GPC ids for garden animation), `buildFlashcardDeck`, `saveFlashcardEvents`, `generateContent` (wraps edge fn call), `saveBenchmark`, `overrideGpcStatus`, `setPin`, `verifyPin`
- **Edge function**: `supabase/functions/generate-content/index.ts` — the only place `ANTHROPIC_API_KEY` is read
- **Model constant**: `supabase/functions/generate-content/config.ts` exporting `CLAUDE_MODEL = "claude-sonnet-4-5"`
- **Secrets**: `ANTHROPIC_API_KEY` requested via add_secret after you approve the plan
- **Types**: shared `AppRole = 'parent'`, `GpcStatus`, `Outcome` enums in `src/lib/types.ts`
- **Testing surface**: pure SRS + decodability validator get vitest coverage; UI verified via Playwright on the guided-session flow end-to-end
