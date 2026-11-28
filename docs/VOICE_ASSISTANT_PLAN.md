# Voice assistant — build plan (2026-11-28)

Goal: a rep taps a mic, says what happened, and a visit is logged in about 20 seconds with no typing. Owner's calls of 2026-11-27 and the
speech-test findings of 2026-11-28 set every rule here. Design canvas: claude.ai artifact **Voice Assistant — Log a Visit**
(https://claude.ai/artifact/JLgHcE1NCdLBCJfj9cbZ8i, 8 phone boards). Memory: `voice-assistant-plan`.

## Principles
1. **Claude only extracts; code decides.** Claude turns text into fields (`src/utils/assistantVisit.ts`). Code picks the customer, decides the next
   question (`nextQuestion`) and saves. Nothing is saved without a tap on the confirm card.
2. **One sentence is enough.** Ask only for what is missing, one question at a time, mic reopens by itself.
3. **A wrong word must be one tap to fix.** Every field on the confirm card is tappable.
4. **No transcripts stored.** Counts and cost only. Audio never leaves the phone (on-device recognition where the iPhone supports it).
5. **Invisible until switched on.** Everything ships behind the `use_voice_assistant` switch and a phone that has the Speech plugin; a browser
   and an old app build show nothing and the Add visit form works exactly as today.

## The conversation
tap mic → **Listening** (live words) → **Thinking** → one of:
- **Which one?** two customers sound alike → cards with city / address; tap one (code ranks, not Claude)
- **Ask one** a missing piece (type / notes / follow-up) → mic reopens
- **Confirm** the visit card (customer, type, day, notes, outcome, follow-up, "On site · 0.1 mi" from the location reading) → **Save**
→ **Saved** (Undo for 10 s, "Add another"). Always a **Type instead** box (also the fallback when speech fails or is blocked).

## Getting the words right (the slang worry)
Four layers, cheapest first; each is measured on the phone test before the next is added.
1. **Hints to the recognizer** (`contextualStrings`, ≤100): stone / brand words + this rep's recent customers. Worked in the first test.
2. **Claude corrects with a glossary:** the prompt carries the company word list + "Voice words" and the visit types; "Cala cotta gold" → "Calacatta Gold".
3. **Sound-alike customer ranking** (`src/utils/soundAlike.ts`, tested): the spoken customer name is matched on sound as well as spelling against the shared
   customer list (`useCustomerOptions`), so "Cascade Fab" still finds Cascade Fabrication.
4. **Voice words list** (Admin → Voice Words): heard → meant pairs and plain words, edited by admins; seeded from `docs/voice-words-DRAFT.md`.
   *Held back:* cloud speech with custom vocabulary (audio leaves the phone — owner's privacy call) and "learn from a rep's fix" (stores a few spoken
   words — needs the owner's OK).

## Build order (each step shippable and invisible)
**A. Server (website deploy).** Switch `use_voice_assistant` (Users & Roles → new "Voice assistant" section; given once to admin, director, manager —
`NEW_PERMISSION_GRANTS`). Tables, Postgres only, next free migration: `voice_words`, `assistant_usage` (user, day, turns, tokens, cost — never text),
and `visits.by_voice` boolean. `src/routes/assistant.ts`: `POST /api/assistant/turn` (switch + 20 s Claude call via `visitExtract.ts`; body ≤ 2,000 chars;
limit 40 turns per person per day and 10 per minute in the Postgres rate-limit store; 503 without `ANTHROPIC_API_KEY`; the transcript is never logged)
and `GET /api/assistant/words` (the ≤100 hints). The visit routes accept `byVoice` only from someone holding the switch. Tests for every rule.
**B. App (needs a new build).** `Speech` bridge plugin (`mobile/src/host/plugins.ts`): `available`, `start({hints})`, `stop`, events for live text and
chunks, joined by `addResult` (already built and tested). Guarded so old builds simply lack it.
**C. Website screens.** `VoiceAssistantButton` (round gold logo above the + on Dashboard, Planner and Customers; hidden without the switch, the plugin
or a phone), `AssistantSheet` with the 8 canvas states on the phone-sheet rules in CLAUDE.md (pinned, page locked, 16px text, no `visualViewport`),
`useLocationReading` started when it opens, save through the ordinary `POST /api/customers/:id/visits` with its own `_id` and `loggedFrom`.
"Logged by voice" chip beside the location chip in the Visit view. Render smoke tests.
**D. Admin → Voice Words.** List + add / edit / hide, seeded once; usage counts for the month at the top. Admins only.
**E. Real-phone round.** Build 17 on the owner's phone, quiet and noisy, 20 real visits; fix; switch on for the owner only, then directors / managers.

## Later (not in this build)
Manager heads-up on a visit, calls and resources by voice, learn-from-fixes, cloud speech with vocabulary, lookups ("what did I log for Smith?"),
scheduling by voice, reps.

## Decisions still open (defaults in bold)
1. Phone can't do on-device recognition → **fall back to Apple's servers** (audio then goes to Apple) / refuse and offer typing.
2. Mic spins **only while listening / thinking** / always.
3. **Admin-edited Voice words only** / also learn from reps' fixes.
4. Daily limit **40 turns per person** (cost ≈ $0.02 per 100 visits on Haiku, so this is a runaway guard, not a budget).
5. HR / legal OK to send the text of a visit to Claude before the switch goes to anyone but the owner.

## Verification
Unit: `assistantVisit`, `addResult`, `soundAlike`, voice-words merge. Routes: switch, limits, no transcript in logs, no key. Render smoke tests for the
button and sheet. By hand on a real iPhone (never run yet): permission prompts, chunk joining with pauses, noisy room, same-name customers, airplane
mode, the keyboard-up rules in CLAUDE.md. `npm run typecheck`, full `npm test` (4 card-receipts parity tests already fail on main).
