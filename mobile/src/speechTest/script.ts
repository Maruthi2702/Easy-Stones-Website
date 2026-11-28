/**
 * What the speech test asks a person to read, and the hint list given to the phone's recognizer.
 * DRAFT: built from docs/voice-words-DRAFT.md (names already in the app). The company's slang and real customer names are not here
 * yet — add them once the owner has filled in section F.
 */
export type TestSentence = { id: string; say: string; terms: string[] };

export const SENTENCES: TestSentence[] = [
  // Stone names, one at a time
  { id: 'stone-1', say: 'Dropped samples of Calacatta Gold and Statuario Opus', terms: ['Calacatta Gold', 'Statuario Opus'] },
  { id: 'stone-2', say: 'They loved the Nero Marquina but wanted it in Calacatta Venato', terms: ['Nero Marquina', 'Calacatta Venato'] },
  { id: 'stone-3', say: 'Looking at Taj Mahal quartzite for the kitchen island', terms: ['Taj Mahal', 'quartzite'] },
  { id: 'stone-4', say: 'Carrara Prima Gold and Bianco Carrara are the two they compared', terms: ['Carrara Prima Gold', 'Bianco Carrara'] },
  { id: 'stone-5', say: 'Arabesco Verde and Perla Oro for the bar top', terms: ['Arabesco Verde', 'Perla Oro'] },
  { id: 'stone-6', say: 'Interested in Statuario Dorato and Luxor Oro', terms: ['Statuario Dorato', 'Luxor Oro'] },
  { id: 'stone-7', say: 'Calacatta Zurich and Calacatta Savoy for the full height backsplash', terms: ['Calacatta Zurich', 'Calacatta Savoy', 'backsplash'] },
  { id: 'stone-8', say: 'Mykonos and Cascada were the favorites', terms: ['Mykonos', 'Cascada'] },
  { id: 'stone-9', say: 'Travete Tempest and Statuary Waves in a honed finish', terms: ['Travete Tempest', 'Statuary Waves', 'honed'] },
  { id: 'stone-10', say: 'Taj Mahal PST Face F in matte', terms: ['Taj Mahal', 'PST', 'matte'] },
  { id: 'stone-11', say: 'Himalaya White, Elusive White and Feather White', terms: ['Himalaya White', 'Elusive White', 'Feather White'] },
  { id: 'stone-12', say: 'Calacatta Mia and Calacatta Bella for the vanity', terms: ['Calacatta Mia', 'Calacatta Bella', 'vanity'] },

  // Brands and product words
  { id: 'brand-1', say: 'Replaced the old Moda tower with the 2025 version', terms: ['Moda', 'tower'] },
  { id: 'brand-2', say: 'Placed a Radianz tabletop and an Ascale tower', terms: ['Radianz', 'tabletop', 'Ascale', 'tower'] },
  { id: 'brand-3', say: 'Left two sample binders and a Moda sample box', terms: ['binders', 'Moda'] },
  { id: 'brand-4', say: 'They also carry MSI and Arizona Tile', terms: ['MSI', 'Arizona Tile'] },
  { id: 'brand-5', say: 'Prestige and Luxe collections are what they asked about', terms: ['Prestige', 'Luxe'] },

  // Work words
  { id: 'work-1', say: 'The fabricator needs a bookmatch from lot 4521', terms: ['fabricator', 'bookmatch', 'lot'] },
  { id: 'work-2', say: 'Three slabs in the bundle, remnants on hold for the dealer', terms: ['slabs', 'bundle', 'remnants'] },
  { id: 'work-3', say: 'Pick up the transfer from Kent and send the packing list', terms: ['transfer', 'Kent', 'packing list'] },
  { id: 'work-4', say: 'Will call on Friday, the builder sent his designer', terms: ['Will call', 'builder', 'designer'] },
  { id: 'work-5', say: 'Showroom visit with the architect and the homeowner', terms: ['showroom', 'architect', 'homeowner'] },

  // Whole visits, the way a rep would really say it
  { id: 'visit-1', say: 'Log a visit at Cascade Fabrication, dropped samples, they liked the Calacatta Gold, follow up Friday', terms: ['Cascade Fabrication', 'Calacatta Gold'] },
  { id: 'visit-2', say: 'Visit at Evergreen Kitchens in Tacoma, placed a Moda tower, they want Statuario Marina next', terms: ['Evergreen Kitchens', 'Tacoma', 'Moda', 'Statuario Marina'] },
  { id: 'visit-3', say: 'Call with Rainier Countertops, they are comparing Radianz against Calacatta Venus, call back Tuesday', terms: ['Rainier Countertops', 'Radianz', 'Calacatta Venus'] },
  { id: 'visit-4', say: 'Quick note for Smith Granite in Spokane, needs two slabs of Taj Mahal quartzite by the fifteenth', terms: ['Smith Granite', 'Spokane', 'Taj Mahal', 'quartzite'] },
  { id: 'visit-5', say: 'Sales meeting at Puget Sound Stone in Salt Lake City, sent the Prestige price list', terms: ['Puget Sound Stone', 'Salt Lake City', 'Prestige'] },

  // Branches
  { id: 'branch-1', say: 'Seattle, Tacoma, Portland and Spokane', terms: ['Seattle', 'Tacoma', 'Portland', 'Spokane'] },
  { id: 'branch-2', say: 'Dallas, Houston, Atlanta and Charlotte', terms: ['Dallas', 'Houston', 'Atlanta', 'Charlotte'] },

  // Numbers and dates
  { id: 'num-1', say: 'Follow up next Friday, about forty slabs, three centimeter thickness', terms: ['forty', 'three centimeter'] }
];

/**
 * Up to ~100 short phrases the phone's recognizer is told to expect (Apple's limit). The hardest words go first so they survive a cut.
 * Kept to names and jargon; customer names for this person are added at run time.
 */
export const HINT_PHRASES: string[] = [
  'Calacatta', 'Statuario', 'Arabesco', 'Travete', 'Mykonos', 'Nero Marquina', 'Taj Mahal', 'Taj Augusta', 'quartzite', 'Cristallo',
  'Moda', 'Radianz', 'Ascale', 'Cabinet IQ', 'bookmatch', 'remnant', 'backsplash', 'StoneProfits', 'RDC', 'ePOD',
  'Calacatta Gold', 'Calacatta Mia', 'Calacatta Bella', 'Calacatta Venato', 'Calacatta Savoy', 'Calacatta Sole', 'Calacatta Umi',
  'Calacatta Wow', 'Calacatta Rama', 'Calacatta Nero', 'Calacatta Venus', 'Calacatta Tesoro', 'Calacatta Zurich', 'Calacatta Lincoln', 'Calacatta Ibiza',
  'Statuario Dorato', 'Statuario Fantasia', 'Statuario Marina', 'Statuario Opus', 'Statuario Piedmont', 'Statuary Waves',
  'Arabesco Croma', 'Arabesco Verde', 'Travete Tempest', 'Perla Oro', 'Luxor Oro', 'Giotto', 'Giotto Oro', 'Enigma',
  'Carrara Deluxe', 'Carrara Prima', 'Carrara Prima Gold', 'Bianco Carrara', 'Himalaya White', 'Elusive White', 'Feather White',
  'Designer White', 'Luminous White', 'Cascada', 'Mystique', 'Olympic', 'Cosmic', 'Panda', 'Sonoma', 'Shadow Gold', 'Structure Grey', 'Chinook Grey',
  'PST', 'Taj Mahal PST', 'Prestige', 'Luxe', 'Signature', 'MSI', 'Arizona Tile', 'Bedrosians', 'tabletop', 'sample binder',
  'Will call', 'packing list', 'pick ticket', 'fabricator', 'showroom',
  'Seattle', 'Kent', 'Tacoma', 'Spokane', 'Portland', 'Salt Lake City', 'Dallas', 'Houston', 'Atlanta', 'Charlotte'
];
