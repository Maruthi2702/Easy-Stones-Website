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

## Architecture (2026-11-28) — the contract is `src/utils/assistantContract.ts`

```
 iPhone app (React Native)                      Website in the WebView                         Server (Express, Render → Lambda)            Postgres
 ┌────────────────────────┐   bridge 'Speech'   ┌────────────────────────────────┐  HTTPS/JSON  ┌──────────────────────────────┐        ┌───────────────┐
 │ expo-speech-recognition│◀───────────────────▶│ VoiceAssistantButton / Sheet   │─────────────▶│ POST /api/assistant/turn     │───────▶│ voice_words   │
 │ on-device, hints,      │  partial · level    │ state machine (pure reducer)   │              │  auth → switch → limits →    │        │ assistant_usage│
 │ chunks joined          │                     │ soundAlike customer ranking    │◀─────────────│  Claude Haiku (extract only) │───────▶│ visits.by_voice│
 └────────────────────────┘                     │ confirm card → existing visit  │              │  → clean → merge → usage row │        └───────────────┘
                                                │ save (loggedFrom, byVoice)     │              │ GET /words · /voice-words    │
                                                └────────────────────────────────┘              └──────────────────────────────┘
```
**Why this shape.** Audio stays on the phone (privacy, cost, speed); the server is **stateless** — the draft travels with each turn, so any instance
(or Lambda) can answer and there is nothing to expire; Claude is a **pure function** text → fields, validated by code (`cleanSpokenVisit`), so a wrong
or hostile answer can only blank a field, never save or pick a customer; the visit goes through the **one existing save path** (idempotent `_id`,
location stamp, permissions, notifications) so the assistant can't create a second way to write a visit.
**Latency budget (target p50 ≈ 2 s from "Done" to the card).** Speech is streamed and joined on the phone (0 s after Done) · one Claude call, low effort,
cached instruction prefix (≈ 1.5 s) · customer ranking on the phone from the list already loaded (instant) · the card is already on screen as a skeleton
while the call runs, fields fade in. Call timeout 8 s, one retry; after 3 failures in a row the server short-circuits for 30 s so a Claude outage costs
the rep nothing but a "Type it instead".
**Failure ladder.** No plugin / browser → button hidden · permission denied → steps to turn it on + typing · nothing heard → "Didn't catch that" + retry ·
Claude fails or limit reached → the words go into the ordinary Add visit form's notes (the rep's own words, theirs to keep) · no customer match → search
box, then Add customer · save fails → the existing save's retry / reopen behaviour.
**Security.** Every route checks the switch on the server; the transcript is data inside a delimited block with a JSON-schema output (no tools given to
the model); `byVoice` is honoured only with the switch; logs carry counts and ms, never text; limits in the Postgres store so every instance shares them;
the server never takes the model's customer — only the person's tap picks it.
**Observability.** One structured line per turn `{userId, ok, reason, ms, model, inTokens, outTokens, cacheRead}` + the `assistant_usage` daily row, shown
to admins (Voice Assistant → Usage). Alarm-worthy numbers: failure rate over 5 %, p95 over 6 s.
**Data.** `voice_words` (id, heard, meant, kind, active, note, timestamps; unique on lower(heard) when set), `assistant_usage` (user_id + day → turns, failed,
tokens, cost; never text), `visits.by_voice boolean not null default false`. Postgres only; one migration.
**UX and transitions (all `transform` / `opacity`, 60 fps, `prefers-reduced-motion` respected).** Mic button: a gold logo that spins only while listening or
thinking and rests otherwise · tap → the sheet rises (~280 ms ease-out) over a dimmed page · listening: the logo pulses with the voice level and the words
appear live, last word highlighted · Done (or 1.8 s of quiet after speech) → the logo spins, the transcript settles into a quote, the confirm card shows as a
skeleton · the answer fills the card top to bottom (40 ms stagger, each field fades up) · a missing piece slides in as ONE question with the mic already open ·
two customers alike → cards with the city, a tap picks and the card closes the gap · Save → the card collapses into a "Saved ✓ Undo" bar (10 s) and the
visit appears in the list behind it · every state has the Type instead box and a Cancel; nothing ever jumps because the sheet is pinned (CLAUDE.md phone rules).

## Who builds what (parallel; each in its own worktree and branch, merged by the lead)
| Agent | Owns | Never touches |
|---|---|---|
| **A · Server** | migration + schema + `src/db/voiceAssistant/`, `src/routes/assistant.ts`, switches + grants, `visits.by_voice`, `assistantVisit.ts` / `visitExtract.ts` extensions (merge, glossary prompt, cache, breaker), word seed | `mobile/`, `src/features/**` |
| **B · Phone** | `mobile/**` (Speech plugin, chunk joining, hints, level events), `src/features/voiceAssistant/speechPlugin.ts` | server, screens |
| **C · Screens** | `src/features/voiceAssistant/**` (except speechPlugin.ts), `src/utils/soundAlike.ts`, mounting the button, the "Voice" chip | server, `mobile/`, admin page |
| **D · Admin** | `src/features/voiceWords/**` (Words · Usage · Speech test tabs), nav entry (replaces `voice_test`), its API client | server routes, `mobile/` |

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
