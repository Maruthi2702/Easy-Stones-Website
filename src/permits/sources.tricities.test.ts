import type { Loose } from '../types/records.ts';
// The Tri-Cities: Richland and Kennewick (Tyler EnerGov, the same reader as
// Renton and Skagit) and Pasco (eTRAKiT through Shoreline's reader) — the types
// seen on the live portals on 2026-11-01 and how Pasco's export becomes a permit.
import { describe, it, expect } from 'vitest';
import pasco, { pascoPermit } from './rules/pasco.ts';
import { RULES, SOURCES, categoryFor, isUnsortedBuildingType, sourcesInCounties } from './permitRules.ts';
import { createPermitReaders } from './readers.ts';

describe('Richland rules', () => {
  it('is in Benton County, as a city, with phones', () => {
    expect(SOURCES.richland).toMatchObject({ county: 'benton', kind: 'city' });
    expect(RULES.richland.phones).toBe(true);
  });
  it('sorts the city’s exact types and skips trades, roofs and outbuildings', () => {
    expect(categoryFor('richland', 'Single Family Dwelling')).toBe('new_home');
    expect(categoryFor('richland', 'Residential Accessory Dwelling Unit')).toBe('adu');
    expect(categoryFor('richland', 'Townhome')).toBe('multifamily');
    expect(categoryFor('richland', 'Residential Addition')).toBe('addition');
    expect(categoryFor('richland', 'Residential Remodel')).toBe('remodel');
    expect(categoryFor('richland', 'New Commercial Construction')).toBe('commercial_new');
    expect(categoryFor('richland', 'Tenant Improvement')).toBe('commercial_remodel');
    for (const t of ['Mechanical', 'Commercial or Residential Re-roof', 'Window or Door Replacement', 'Residential No Fee Accessory Structure', 'Detached Accessory Structure', 'Fire - Alarm Systems', 'Right of Way - Utility', 'Plumbing - Water - Sewer', 'Demolition']) {
      expect(categoryFor('richland', t), t).toBeNull();
      expect(isUnsortedBuildingType('richland', t), t).toBe(false);
    }
  });
  it('reports a building type nobody has sorted', () => {
    expect(isUnsortedBuildingType('richland', 'Residential Tiny Home')).toBe(true);
    expect(isUnsortedBuildingType('richland', 'Residential Remodel')).toBe(false);
  });
});

describe('Kennewick rules', () => {
  it('is in Benton County, as a city, with phones', () => {
    expect(SOURCES.kennewick).toMatchObject({ county: 'benton', kind: 'city' });
    expect(RULES.kennewick.phones).toBe(true);
  });
  it('sorts the city’s exact types, filing alteration/addition as Other building', () => {
    expect(categoryFor('kennewick', 'Detached Single Family Dwelling')).toBe('new_home');
    expect(categoryFor('kennewick', 'Residential - Express Single Family Dwelling')).toBe('new_home');
    expect(categoryFor('kennewick', 'Attached Single Family Dwelling')).toBe('multifamily');
    expect(categoryFor('kennewick', 'Residential - Alteration/Addition')).toBe('building_other');
    expect(categoryFor('kennewick', 'Residential - Express Alteration/Addition')).toBe('building_other');
    expect(categoryFor('kennewick', 'Commercial - New ')).toBe('commercial_new');
    expect(categoryFor('kennewick', 'Commercial - Alteration No Site Plan')).toBe('commercial_remodel');
  });
  it('skips trades, roofs, windows, outbuildings, public works and utilities without reporting them', () => {
    for (const t of ['Residential - Reroof', 'Residential - Windows', 'Residential - Mechanical', 'Commercial - Plumbing', 'Residential - Express Deck', 'Residential - Adult Family Home',
      'Residential Water/Sewer Connection Permit', 'Public Works Utility', 'Fire Sprinkler Installation - New System Install', 'Wall Sign', 'Commercial - Demo']) {
      expect(categoryFor('kennewick', t), t).toBeNull();
      expect(isUnsortedBuildingType('kennewick', t), t).toBe(false);
    }
    expect(isUnsortedBuildingType('kennewick', 'Residential - Tiny Home')).toBe(true);
  });
});

const PASCO_NEW_HOME = {
  PERMIT_NO: 'B26-1167', SITE_ADDR: '916 ROAD 64', STATUS: 'ISSUED', CONTRACTOR_NAME: 'OWNER BUILDER', PERMITTYPE: 'RESIDENTIAL NEW CONSTRUCTION', PERMITSUBTYPE: 'SFDU',
  SITE_APN: '119670021', OWNER_NAME: 'ELIZABETH DUARTE BUENO', APPLICANT_NAME: 'ELIZABETH DUARTE BUENO', ISSUED: '10/15/2026', JOBVALUE: '494086.4',
  DESCRIPTION: 'SFDU SHORT PLAT 2020-13 LOT 3', APPLIED: '09/17/2026', EXPIRED: '04/24/2027', FINALED: '', RECORDID: 'SG02:26091713292398709837'
};

describe('Pasco rules', () => {
  it('is in Franklin County, as a city', () => {
    expect(RULES.pasco).toBe(pasco);
    expect(SOURCES.pasco).toMatchObject({ county: 'franklin', kind: 'city' });
  });
  it('copies a permit from the export, dropping the form’s placeholders and repeats', () => {
    const p = pascoPermit(PASCO_NEW_HOME);
    expect(p).toMatchObject({
      source: 'pasco', permitNumber: 'B26-1167', externalId: 'SG02:26091713292398709837', category: 'new_home', type: 'RESIDENTIAL NEW CONSTRUCTION', subtype: 'SFDU',
      status: 'ISSUED', appliedOn: '2026-09-17', issuedOn: '2026-10-15', expiresOn: '2027-04-24', address: '916 ROAD 64', city: 'Pasco', parcel: '119670021', valuation: 494086.4
    });
    // "OWNER BUILDER" isn't a company, and the applicant is the owner: one line.
    expect(p.contacts).toMatchObject([{ role: 'Owner', name: 'ELIZABETH DUARTE BUENO' }]);
    expect(p.contacts).toHaveLength(1);
    expect(pascoPermit({ ...PASCO_NEW_HOME, CONTRACTOR_NAME: 'INFORMATION PROVIDED AT A LATER DATE' }).contacts).toHaveLength(1);
    expect(pascoPermit({ ...PASCO_NEW_HOME, CONTRACTOR_NAME: 'HAYDEN HOMES', APPLICANT_NAME: 'HAYDEN HOMES' }).contacts).toMatchObject([{ role: 'Contractor', company: 'HAYDEN HOMES' }, { role: 'Owner' }]);
  });
  it('sorts the city’s type and sub type, skipping trades, rights of way and outbuildings', () => {
    expect(categoryFor('pasco', 'RESIDENTIAL NEW CONSTRUCTION', 'TOWNHOUSE')).toBe('multifamily');
    expect(categoryFor('pasco', 'RESIDENTIAL', 'ACCESSORY DWELLING')).toBe('adu');
    expect(categoryFor('pasco', 'RESIDENTIAL', 'MAJOR ALTER/REPAIR')).toBe('remodel');
    expect(categoryFor('pasco', 'COMMERCIAL TENANT IMPROVEMENTS', '')).toBe('commercial_remodel');
    expect(categoryFor('pasco', 'COMMERCIAL', 'MINOR ALTER/REPAIR')).toBe('commercial_remodel');
    for (const [t, s] of [['RESIDENTIAL MECHANICAL', 'SFDU'], ['WATER SEWER', 'RESIDENTIAL'], ['RIGHT OF WAY', 'DRIVEWAY APPROACH'], ['RESIDENTIAL', 'ACCESSORY STRUCTURES'],
      ['RESIDENTIAL', 'DEMOLITION'], ['RESIDENTIAL', 'DETACHED GARAGE/SHOP'], ['RESIDENTIAL ACCESSORY STRUCTURE', 'GARAGE'], ['COMMERCIAL', 'SIGN'], ['CIVIL', 'SUBDIVISION IMPROVEMENTS']]) {
      expect(categoryFor('pasco', t, s), `${t} ${s}`).toBeNull();
      expect(isUnsortedBuildingType('pasco', t, s), `${t} ${s}`).toBe(false);
    }
    expect(isUnsortedBuildingType('pasco', 'COMMERCIAL', 'NEW')).toBe(true);
  });
});

describe('Benton and Franklin counties', () => {
  it('lists the Tri-Cities offices by county', () => {
    expect(sourcesInCounties(['benton'])).toEqual(['kennewick', 'richland']);
    expect(sourcesInCounties(['franklin'])).toEqual(['pasco']);
  });
  it('has a reader for each', () => {
    const readers = createPermitReaders() as Loose;
    for (const id of ['kennewick', 'richland', 'pasco']) expect(typeof readers[id].issuedSince, id).toBe('function');
    expect(typeof readers.richland.details).toBe('function');
  });
});
