import { describe, expect, it } from 'vitest';
import { filterDives, DEFAULT_DIVE_LIST_FILTERS } from './diveListFilters';
import type { DiveListFilters } from './diveListFilters';
import type { StoredDive } from '../db/Dive';
import type { CanonicalDive } from '@divesend/core';

function makeCanonicalDive(overrides: Partial<CanonicalDive['header']> = {}): CanonicalDive {
  return {
    header: {
      startTime: '2026-07-28T12:26:00Z',
      maxDepthM: 3.63,
      gasO2Percent: 21.0,
      gasHePercent: 0.0,
      tankBeginPressureBar: 130.59,
      tankEndPressureBar: 103.01,
      diveMode: 'oc',
      decoModel: 'buhlmann',
      gfLow: 50,
      gfHigh: 85,
      salinity: 'salt',
      deviceModel: 'Shearwater Teric',
      divetimeS: 600,
      minTemperatureC: null,
      maxTemperatureC: null,
      cnsPercent: null,
      ...overrides,
    },
    samples: [],
  };
}

function makeDive(overrides: Partial<StoredDive> = {}, headerOverrides: Partial<CanonicalDive['header']> = {}): StoredDive {
  return {
    id: overrides.id ?? '1',
    diveId: overrides.diveId ?? overrides.id ?? '1',
    date: '2026-07-28T12:26:00Z',
    maxDepthM: 3.63,
    durationMinutes: 10,
    computerModel: 'Shearwater Teric',
    canonicalDive: makeCanonicalDive(headerOverrides),
    syncState: 'notSynced',
    deviceSerialNumber: null,
    ssiDiveID: null,
    ssiDiveNumber: null,
    ...overrides,
  };
}

describe('filterDives', () => {
  it('returns all dives when filters are all "all" and showHidden is off, excluding hidden dives', () => {
    const visible = makeDive({ id: 'v' });
    const hidden = makeDive({ id: 'h', hidden: true });
    const undefinedHidden = makeDive({ id: 'u', hidden: undefined });

    const result = filterDives([visible, hidden, undefinedHidden], DEFAULT_DIVE_LIST_FILTERS);

    expect(result.map((d) => d.id)).toEqual(['v', 'u']);
  });

  describe('dive type filter', () => {
    const scuba = makeDive({ id: 'scuba' }, { diveMode: 'oc' });
    const ccr = makeDive({ id: 'ccr' }, { diveMode: 'ccr' });
    const gauge = makeDive({ id: 'gauge' }, { diveMode: 'gauge' });
    const free = makeDive({ id: 'free' }, { diveMode: 'freedive' });
    const dives = [scuba, ccr, gauge, free];

    it('"all" passes every dive', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, diveType: 'all' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['scuba', 'ccr', 'gauge', 'free']);
    });

    it('"scuba" includes oc/ccr/scr/gauge but not freedive', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, diveType: 'scuba' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['scuba', 'ccr', 'gauge']);
    });

    it('"freedive" includes only freedive', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, diveType: 'freedive' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['free']);
    });
  });

  describe('water type filter', () => {
    const salt = makeDive({ id: 'salt' }, { salinity: 'salt' });
    const fresh = makeDive({ id: 'fresh' }, { salinity: 'fresh' });
    const other = makeDive({ id: 'other' }, { salinity: 'brackish' });
    const dives = [salt, fresh, other];

    it('"all" passes every dive', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, waterType: 'all' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['salt', 'fresh', 'other']);
    });

    it('"salt" matches only exact "salt"', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, waterType: 'salt' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['salt']);
    });

    it('"fresh" matches only exact "fresh"', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, waterType: 'fresh' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['fresh']);
    });

    it('"other" buckets any non-salt/fresh value', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, waterType: 'other' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['other']);
    });
  });

  describe('sync status filter', () => {
    const notSynced = makeDive({ id: 'notSynced', syncState: 'notSynced' });
    const synced = makeDive({ id: 'synced', syncState: 'synced' });
    const doNotSync = makeDive({ id: 'doNotSync', syncState: 'doNotSync' });
    const dives = [notSynced, synced, doNotSync];

    it('"all" passes every dive', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, syncStatus: 'all' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['notSynced', 'synced', 'doNotSync']);
    });

    it('"unsynced" matches only notSynced', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, syncStatus: 'unsynced' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['notSynced']);
    });

    it('"synced" buckets doNotSync together with synced', () => {
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, syncStatus: 'synced' };
      expect(filterDives(dives, filters).map((d) => d.id)).toEqual(['synced', 'doNotSync']);
    });
  });

  describe('hidden dives', () => {
    it('excludes hidden dives by default', () => {
      const hidden = makeDive({ id: 'hidden', hidden: true });
      expect(filterDives([hidden], DEFAULT_DIVE_LIST_FILTERS)).toEqual([]);
    });

    it('includes hidden dives mixed in with the rest when showHidden is on', () => {
      const hidden = makeDive({ id: 'hidden', hidden: true });
      const visible = makeDive({ id: 'visible' });
      const filters: DiveListFilters = { ...DEFAULT_DIVE_LIST_FILTERS, showHidden: true };
      expect(filterDives([hidden, visible], filters).map((d) => d.id)).toEqual(['hidden', 'visible']);
    });

    it('treats hidden === undefined as visible even when showHidden is off', () => {
      const dive = makeDive({ id: 'x', hidden: undefined });
      expect(filterDives([dive], DEFAULT_DIVE_LIST_FILTERS).map((d) => d.id)).toEqual(['x']);
    });
  });

  it('combines all filters with AND logic', () => {
    const match = makeDive({ id: 'match', syncState: 'notSynced' }, { diveMode: 'oc', salinity: 'salt' });
    const wrongType = makeDive({ id: 'wrongType', syncState: 'notSynced' }, { diveMode: 'freedive', salinity: 'salt' });
    const wrongWater = makeDive({ id: 'wrongWater', syncState: 'notSynced' }, { diveMode: 'oc', salinity: 'fresh' });
    const wrongSync = makeDive({ id: 'wrongSync', syncState: 'synced' }, { diveMode: 'oc', salinity: 'salt' });
    const hiddenMatch = makeDive({ id: 'hiddenMatch', syncState: 'notSynced', hidden: true }, { diveMode: 'oc', salinity: 'salt' });

    const filters: DiveListFilters = {
      diveType: 'scuba',
      waterType: 'salt',
      syncStatus: 'unsynced',
      showHidden: false,
    };

    const result = filterDives([match, wrongType, wrongWater, wrongSync, hiddenMatch], filters);
    expect(result.map((d) => d.id)).toEqual(['match']);
  });
});
