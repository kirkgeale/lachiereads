# Plan: outcomes, freshness, lesson redesign, richer flashcards

## 1. Four outcome buttons everywhere

Add `self_corrected` and `prompted` to the `Outcome` type used by flashcards, lessons, and assessment.

**UI (`OutcomeButtons.tsx`)** — 4 buttons, wraps to 2×2 on mobile:
- ✅ **Got it** (green) — first-try correct
- 🔄 **Self-corrected** (teal) — said wrong, then fixed it unaided
- 💬 **Prompted** (amber) — parent gave a cue ("what's that sound in English?")
- ❌ **Missed** (red) — couldn't read even with a prompt

A tiny help chip under the buttons explains the difference on first use.

**SRS mapping (`src/lib/srs.ts`)**
- `got_it` → promote box, streak++
- `self_corrected` → small promote (streak++, box unchanged unless streak ≥3) — strong signal but retrieval wasn't clean
- `prompted` → hold (no streak change, no box change), mark for same-session re-queue
- `missed` → demote to `learning`, streak = 0

**Signal to Claude** — strengths still require clean `got_it`. Challenges include any item that was `missed`, `prompted`, or `self_corrected` in the last ~30 events. Prompted items also flow into `recent_misses` so Claude gently re-exposes them.

**Assessment** — same 4 buttons; the report distinguishes independent vs supported reads.

## 2. Fresh content each session (daily cache)

Fix: `src/lib/content-helper.ts` currently hashes on `(type, graphemes, heart words, misses, strengths, challenges)` — none change between back-to-back sessions, so Claude's output is cached and identical.

Change: add a **daily salt** to the encode key — `d=${YYYY-MM-DD}` and a `session_seq` (1st, 2nd… session of the day for that learner). Result:
- Repeat sessions same day → different words
- Second day → fresh regardless
- Within one session render, still cached (no duplicate Claude calls per card)

`session_seq` comes from counting today's sessions for the learner at plan-build time.

## 3. Lesson redesign — 8 phase-gated stages

New planner in `session.functions.ts` builds stages based on the learner's current phase (max phase across secure GPCs):

```text
Stage                Phase gate    Typical count
1. Warm-up           always        3–4 known sounds (confidence)
2. Target sound      always        1 focus grapheme + mouth cue + example
3. Blend ladder      phase ≥ 2     CV → CVC → CCVC using target (4–6 rungs)
4. Word reading      always        8–10 words featuring target + review
5. Sentence          phase ≥ 3     1–3 short decodable sentences
6. Story             phase ≥ 5     3–5 sentence mini-story
7. Interference      when relevant SV/EN minimal-pair check
8. Wrap-up           always        celebrate + parent note
```

Each stage renders with its own header card so the parent knows what to model. Cards carry `stage` (already in `SessionCard`) plus a new `stage_intro?: { title, guidance }` for the parent-facing prompt (e.g. "Model the sound once, then invite them to try").

Target session length ~15–20 min. Flashcards remain ~3–5 min.

## 4. Richer flashcards

`buildFlashcardDeck` currently draws only from GPCs and heart words. Update to a **balanced mix of 20**:
- ~8 sound cards (GPCs due in Leitner)
- ~4 heart words (due)
- ~8 decodable words at level — generated via `generate-content` with `type: "game_words"` using allowed graphemes, then rendered as word cards

Adaptive weighting: if a dimension has many due items, take more from that bucket. Cards keep the "sound/heart/word" tag on the card so we log the right `item_type`.

## Technical notes

**Files to change**
- `src/lib/types.ts` — extend `Outcome`, add `stage_intro` to `SessionCard`
- `src/lib/srs.ts` — outcome→SRS mapping
- `src/components/OutcomeButtons.tsx` — 4 buttons + help chip
- `src/lib/content-helper.ts` — daily+seq salt in encode key
- `src/lib/session.functions.ts` — daily session seq lookup; new lesson planner (stages 1–8, phase gates); enriched flashcard deck; strengths/challenges now count `got_it` only
- `src/components/ItemCard.tsx` — render `stage_intro` when present
- `supabase/functions/generate-content/index.ts` — no prompt change needed (already handles all types); confirm blend-ladder generation via `word_list` with target grapheme
- `src/routes/parent.assessment.$learnerId.tsx` — use new OutcomeButtons

**No schema change.** `session_events.outcome` is already a free text column (or enum — will verify and migrate only if it's an enum that needs the two new values).

**Backward compat.** Old `session_events` rows with 3 outcomes still parse; strengths/challenges logic treats unknown outcomes as neutral.

## Out of scope for this pass
- Rewriting the assessment scoring model around the 4 outcomes (will note "supported vs independent" but keep current scoring)
- Parent-side lesson script/guidance content library beyond one line per stage
