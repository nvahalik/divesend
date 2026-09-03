// @vitest-environment jsdom
// Uses browser localStorage, which this repo's default `node` vitest environment doesn't
// provide -- scope jsdom to just this file rather than switching the whole suite.
import { afterEach, describe, expect, it } from 'vitest';
import { loadLastUsed, saveLastUsed, LAST_USED_STORAGE_KEY } from './extraDiveDetailsStorage';

afterEach(() => {
  localStorage.removeItem(LAST_USED_STORAGE_KEY);
});

describe('extraDiveDetailsStorage', () => {
  it('returns undefined when nothing is stored', () => {
    expect(loadLastUsed()).toBeUndefined();
  });

  it('saves then loads round trips', () => {
    const details = { tankVolumeL: 11.1, diveTypeID: 24, siteID: 22489, siteName: 'Some Site' };
    saveLastUsed(details);
    expect(loadLastUsed()).toEqual(details);
  });
});
