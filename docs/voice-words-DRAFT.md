# Voice words — DRAFT for correction (2026-11-27)

Written by Claude from what is already in the app (the product catalog, resource types, branch and visit-type names). **Nothing here comes from how your reps actually talk.** Section F is empty on purpose — only you can fill it.

How it will be used: this list feeds (1) the phone's speech recognizer hints (Apple takes about 100 short phrases, so the ★ words go first), and (2) Claude, which fixes the transcript against it and against the rep's customer names. Later it becomes an Admin page ("Voice words").

**Please:** cross out what nobody says, fix spellings, add what's missing, and fill section F.

---

## A. Stone / color names (from the catalog, 51 products)

★ = hard for a phone to hear (foreign or invented word). "Might hear as" is my guess; the real test will show the true ones.

| Say | Might hear as |
|---|---|
| ★ Calacatta (also Gold, Mia, Bella, Venato, Savoy, Sole, Umi, Wow, Rama, Nero, Venus, Tesoro, Zurich, Lincoln, Ibiza) | "cala cotta", "Calicut" |
| ★ Statuario (Dorato, Fantasia, Marina, Opus, Piedmont) / Statuary Waves | "statue Ario", "stature io" |
| ★ Arabesco (Croma, Verde) | "arabesque o" |
| ★ Travete (Tempest) | "travertine", "trav it" |
| ★ Mykonos | "my conos", "Mikonos" |
| ★ Giotto / Giotto Oro | "Giotto" is often fine; "Oro" → "oh row" |
| ★ Perla Oro, Luxor Oro | "pearl a oh row", "Luxor" ok |
| ★ Nero Marquina | "nero mark Keena", "Nairobi" |
| ★ Taj Mahal (PST Face F / M Matte / M Polish / P / T), Taj Augusta | "PST" → "P S T", "pee ass tea" |
| Carrara Deluxe, Carrara Prima, Carrara Prima Gold, Bianco Carrara | "Carrera" |
| ★ Cascada, Himalaya White, Mystique, Elusive White, Feather White, Designer White, Luminous White | mostly fine |
| Olympic, Crystal, Cosmic, Panda, Sonoma, Shadow, Shadow Gold, Carbon (Matte), Structure Grey/Gray, Chinook Grey, Manatee, Sandstone, Enigma (Gold) | common words, but "Panda", "Cosmic" can clash with ordinary speech |
| ★ Cristallo, Fusion | |

Stone words used in conversation: ★ quartzite ("quartz site"), quartz, granite, marble, soapstone, porcelain, onyx, dolomite, travertine, **bookmatch / book-match**, remnant, backsplash, countertop, vanity, polished, honed, leathered, brushed, matte.

**Catalog spelling problems I noticed** (so the list and the spoken name agree):
- `Cararra Prima Gold` in products.ts is spelled differently from `Carrara Prima Gold` in the colors list.
- `Calacatta Zurich` (products) vs `Calacatta Zurrich` (colors list).
- `Structure Gray` vs `Structure Grey`; `Statuary Waves 45` vs `Statuary Waves`.
- `Calacatta Bella` (products) vs `Calacatta Bella Nuo` (colors).

## B. Collections, brands and competitors

★ Moda ("mode a", "Modah") · ★ Radianz ("radiance") · ★ Ascale ("a scale", "ask ale") · MODA PST · Easy Stones · Easy Surfaces
Collections: Basic · Signature · Prestige · Luxe
Others seen in the app: MSI · Arizona Tile · Bedrosians · ★ Cabinet IQ

## C. Product and resource words

tower · tabletop · binder / sample binder · samples · A&D box · "Moda Tower 2025 V3" · "Sample Binder South / SouthEast / NorthWest" · slab · bundle · lot · lot number · block · bookmatch · remnant · thickness (2 cm / 3 cm) · selection sheet · hold · cart · crossover sheet · price list

## D. Branches

Seattle · Kent · Tacoma · Spokane · Portland · Salt Lake City · Dallas · Houston · Atlanta · Charlotte · ★ Demo (hidden — never to be offered)

## E. Business words

StoneProfits · SPS · ★ RDC · transfer · Will Call · pick ticket / pick-up · packing list · sales order · BOL · ★ ePOD / POD · drop-off · fabricator · dealer · builder · designer · architect · contractor · homeowner · showroom · yard · container · follow-up · "on site" · Level 1–4 customers

Visit types as people say them (real ones from Admin → Visit Types): quick note · follow-up notes · scheduled sales meeting · unscheduled sales call · resource placement · resource update · formal presentation · remote meeting / call · admin day · time off

## F. YOUR slang — please fill in

I can't guess these. For each, write what the rep says and what it means. Examples of the kind I mean (replace with real ones):

| What reps say | What it means |
|---|---|
| (e.g. "a tower drop") | (a Resource placement of a tower) |
| (e.g. "the Kent yard") | |
| | |
| | |
| | |
| | |
| | |
| | |

Also useful: nicknames reps use for **customers** ("Smitty's" for Smith Granite) and for **stones** ("Cala Gold").

---

## What happens next (nothing built yet)

1. You correct this list and add slang.
2. I write a ~40-sentence script using these words and customer names. A few reps read it into an iPhone; we count mistakes with no hints, with phone hints, and with hints plus Claude's correction.
3. Only then we decide whether the iPhone engine is good enough, or whether a speech service with a custom vocabulary is needed (that would send audio off the phone — your decision).
