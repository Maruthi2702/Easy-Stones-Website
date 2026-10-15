/**
 * Where permits come from (2026-10-14): states and their counties, for the
 * Permits screen's county filter. Every county is listed whether or not the
 * app pulls its permits yet — a source names its county (rules/<source>.js),
 * and that's what makes a county "covered".
 *
 * Ids are lower-case and fixed: saved filters and links hold them.
 *
 * Pure: shared by the server and the screen.
 */

export const STATES = Object.freeze([
  {
    id: 'wa',
    name: 'Washington',
    counties: Object.freeze([
      'Adams', 'Asotin', 'Benton', 'Chelan', 'Clallam', 'Clark', 'Columbia', 'Cowlitz', 'Douglas', 'Ferry',
      'Franklin', 'Garfield', 'Grant', 'Grays Harbor', 'Island', 'Jefferson', 'King', 'Kitsap', 'Kittitas',
      'Klickitat', 'Lewis', 'Lincoln', 'Mason', 'Okanogan', 'Pacific', 'Pend Oreille', 'Pierce', 'San Juan',
      'Skagit', 'Skamania', 'Snohomish', 'Spokane', 'Stevens', 'Thurston', 'Wahkiakum', 'Walla Walla',
      'Whatcom', 'Whitman', 'Yakima'
    ].map((name) => Object.freeze({ id: name.toLowerCase().replace(/\s+/g, '_'), name })))
  }
]);

export const COUNTIES = Object.freeze(STATES.flatMap((s) => s.counties.map((c) => ({ ...c, state: s.id }))));
export const COUNTY_IDS = Object.freeze(COUNTIES.map((c) => c.id));
export const countyName = (id) => COUNTIES.find((c) => c.id === id)?.name || '';
/** 'King County', or '' for an unknown id. */
export const countyLabel = (id) => (countyName(id) ? `${countyName(id)} County` : '');
