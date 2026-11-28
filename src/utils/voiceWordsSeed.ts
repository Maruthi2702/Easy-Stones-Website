/**
 * The words the voice list starts with (2026-11-28), from docs/voice-words-DRAFT.md sections A–E — what is already in the app (the
 * product catalog, brands, branches, business words). Written by Claude, NOT from how reps really talk: the "heard" guesses are
 * guesses, and slang (section F) is for the owner to add in Admin → Voice Words. Hidden location "Demo" is left out on purpose.
 *
 * Used once: `seedVoiceWords` fills an EMPTY table with it; after that the database is the only source, and editing this file changes
 * nothing. Order matters — it is the priority the phone's hint list is cut at (100 phrases), hardest to hear first.
 */
import type { VoiceWordInput, VoiceWordKind } from './assistantContract.ts';

type Row = [meant: string, kind: VoiceWordKind, heard?: string[]];

/** Words that carry a known mis-hearing: each "heard" makes its own row, so an admin can edit or hide one alone. */
const HARD: Row[] = [
  ['Calacatta', 'stone', ['cala cotta', 'calla cotta', 'cala cata']],
  ['Statuario', 'stone', ['statue ario', 'stature io']],
  ['Arabesco', 'stone', ['arabesque o']],
  ['Mykonos', 'stone', ['my conos', 'mikonos']],
  ['Nero Marquina', 'stone', ['nero mark keena', 'nero mar keena']],
  ['Perla Oro', 'stone', ['pearl a oh row']],
  ['Carrara', 'stone', ['carrera']],
  ['quartzite', 'stone', ['quartz site']],
  ['bookmatch', 'stone', ['book match']],
  ['Moda', 'brand', ['mode a', 'modah']],
  ['Radianz', 'brand', ['radiance']],
  ['Ascale', 'brand', ['a scale', 'ask ale']],
  ['PST', 'stone', ['p s t', 'pee ass tea']],
  ['Cabinet IQ', 'brand', ['cabinet i q', 'cabinet ike you']],
  ['ePOD', 'business', ['e pod', 'e p o d']],
  ['RDC', 'business', ['r d c']]
];

/** Plain words: only a spelling and a hint, hardest first. */
const PLAIN: Row[] = [
  // A. Stone / colour names (the catalog's)
  ['Calacatta Gold', 'stone'], ['Calacatta Mia', 'stone'], ['Calacatta Bella', 'stone'], ['Calacatta Venato', 'stone'], ['Calacatta Savoy', 'stone'],
  ['Calacatta Sole', 'stone'], ['Calacatta Umi', 'stone'], ['Calacatta Wow', 'stone'], ['Calacatta Rama', 'stone'], ['Calacatta Nero', 'stone'],
  ['Calacatta Venus', 'stone'], ['Calacatta Tesoro', 'stone'], ['Calacatta Zurich', 'stone'], ['Calacatta Lincoln', 'stone'], ['Calacatta Ibiza', 'stone'],
  ['Statuario Dorato', 'stone'], ['Statuario Fantasia', 'stone'], ['Statuario Marina', 'stone'], ['Statuario Opus', 'stone'], ['Statuario Piedmont', 'stone'],
  ['Statuary Waves', 'stone'], ['Arabesco Croma', 'stone'], ['Arabesco Verde', 'stone'], ['Travete Tempest', 'stone'], ['Giotto', 'stone'], ['Giotto Oro', 'stone'],
  ['Luxor Oro', 'stone'], ['Taj Mahal', 'stone'], ['Taj Augusta', 'stone'], ['Cascada', 'stone'], ['Himalaya White', 'stone'], ['Mystique', 'stone'],
  ['Elusive White', 'stone'], ['Feather White', 'stone'], ['Designer White', 'stone'], ['Luminous White', 'stone'], ['Cristallo', 'stone'], ['Fusion', 'stone'],
  ['Carrara Deluxe', 'stone'], ['Carrara Prima', 'stone'], ['Carrara Prima Gold', 'stone'], ['Bianco Carrara', 'stone'],
  ['Olympic', 'stone'], ['Crystal', 'stone'], ['Cosmic', 'stone'], ['Panda', 'stone'], ['Sonoma', 'stone'], ['Shadow', 'stone'], ['Shadow Gold', 'stone'],
  ['Carbon', 'stone'], ['Structure Grey', 'stone'], ['Chinook Grey', 'stone'], ['Manatee', 'stone'], ['Sandstone', 'stone'], ['Enigma', 'stone'], ['Enigma Gold', 'stone'],
  ['soapstone', 'stone'], ['porcelain', 'stone'], ['onyx', 'stone'], ['dolomite', 'stone'], ['travertine', 'stone'], ['remnant', 'stone'], ['backsplash', 'stone'],
  ['countertop', 'stone'], ['vanity', 'stone'], ['leathered', 'stone'], ['honed', 'stone'],
  // B. Collections, brands, competitors
  ['Easy Stones', 'brand'], ['Easy Surfaces', 'brand'], ['MODA PST', 'brand'], ['Basic', 'brand'], ['Signature', 'brand'], ['Prestige', 'brand'], ['Luxe', 'brand'],
  ['MSI', 'brand'], ['Arizona Tile', 'brand'], ['Bedrosians', 'brand'],
  // C. Product and resource words
  ['A&D box', 'business'], ['sample binder', 'business'], ['tower', 'business'], ['tabletop', 'business'], ['selection sheet', 'business'], ['crossover sheet', 'business'],
  ['price list', 'business'], ['lot number', 'business'], ['bundle', 'business'], ['slab', 'business'],
  // E. Business words
  ['StoneProfits', 'business'], ['SPS', 'business'], ['Will Call', 'business'], ['pick ticket', 'business'], ['packing list', 'business'], ['sales order', 'business'],
  ['BOL', 'business'], ['POD', 'business'], ['fabricator', 'business'], ['showroom', 'business'], ['follow-up', 'business'], ['homeowner', 'business'],
  // D. Branches (never "Demo": it is a hidden location)
  ['Seattle', 'branch'], ['Kent', 'branch'], ['Tacoma', 'branch'], ['Spokane', 'branch'], ['Portland', 'branch'], ['Salt Lake City', 'branch'],
  ['Dallas', 'branch'], ['Houston', 'branch'], ['Atlanta', 'branch'], ['Charlotte', 'branch']
];

/** The starting list, hardest first: words with a known mis-hearing, then the plain ones. */
export const STARTING_VOICE_WORDS: VoiceWordInput[] = [
  ...HARD.flatMap(([meant, kind, heards]) => (heards || ['']).map((heard) => ({ heard, meant, kind }))),
  ...PLAIN.map(([meant, kind]) => ({ heard: '', meant, kind }))
];
