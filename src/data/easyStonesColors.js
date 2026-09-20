// Historical seed source only — NOT the live catalog. The live, editable
// source of truth is the EasyStonesColor collection (src/models/
// EasyStonesColor.js), managed via the Crossover Sheet's "Manage Colors"
// UI. server.js seeds that collection from this array once, only while it's
// empty (a brand-new environment) — editing this file has zero effect on
// any database that has already been seeded, which is every environment
// that matters today. Sourced from the Moda Quartz confidential price sheet
// (MQESQ32026, published 09/01/2026), kept here only for that initial seed.
export const EASY_STONES_COLORS = [
  'Elusive White', 'Feather White', 'Crystal', 'Olympic',
  'Chinook Grey', 'Carrara Deluxe', 'Carrara Prima', 'Carrara Prima Gold', 'Designer White',
  'Cosmic', 'Manatee', 'Sandstone', 'Structure Grey', 'Bianco Carrara', 'Mystique', 'Cascada', 'Himalaya White',
  'Enigma', 'Enigma Gold', 'Giotto', 'Giotto Oro', 'Calacatta Mia', 'Shadow', 'Calacatta Zurrich', 'Calacatta Bella Nuo',
  'Calacatta Lincoln', 'Calacatta Savoy', 'Carbon Matte', 'Shadow Gold', 'Calacatta Mia Gold', 'Nero Marquina',
  'Statuario Dorato', 'Calacatta Venato', 'Calacatta Rama', 'Calacatta Nero', 'Calacatta Sole', 'Calacatta Umi', 'Calacatta Wow', 'Calacatta Ibiza',
  'Taj Augusta',
  'Statuary Waves', 'Mykonos', 'Sonoma', 'Calacatta Venus', 'Calacatta Tesoro',
  'Panda', 'Perla Oro', 'Arabesco Verde', 'Arabesco Croma', 'Statuario Opus', 'Statuario Piedmont',
  'Statuario Fantasia', 'Statuario Marina', 'Luxor Oro', 'Travete Harvest', 'Travete Giaco', 'Travete Tempest',
  'Taj Mahal PST Face T', 'Taj Mahal PST Face M - Matte'
];
