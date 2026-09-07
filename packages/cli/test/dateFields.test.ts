import { describe, it, expect } from 'vitest';
import { ssiDateFields, localIsoFromUtc } from '../src/dateFields.js';

describe('localIsoFromUtc', () => {
  it('returns the string unchanged when the offset is null', () => {
    expect(localIsoFromUtc('2026-07-30T19:07:51Z', null)).toBe('2026-07-30T19:07:51Z');
  });

  it('folds a negative offset back into the wall-clock (Teric -04:00)', () => {
    expect(localIsoFromUtc('2026-07-30T19:07:51Z', -240)).toBe('2026-07-30T15:07:51-04:00');
  });

  it('folds a positive, non-whole-hour offset', () => {
    expect(localIsoFromUtc('2026-01-01T14:15:00Z', 330)).toBe('2026-01-01T19:45:00+05:30');
  });

  it('rolls the date backward when the shift crosses midnight', () => {
    expect(localIsoFromUtc('2026-07-30T02:00:00Z', -240)).toBe('2026-07-29T22:00:00-04:00');
  });

  it('emits +00:00 for a zero offset', () => {
    expect(localIsoFromUtc('2026-07-30T19:07:51Z', 0)).toBe('2026-07-30T19:07:51+00:00');
  });

  it('feeds ssiDateFields a local wall-clock it accepts', () => {
    expect(ssiDateFields(localIsoFromUtc('2026-07-30T19:07:51Z', -240))).toEqual({
      datetime: '2026-07-30 15:07',
      date: '2026-07-30',
      entry_time: '15:07',
      dive_ref: '2026-07-30T15:07:51.000-04:00_0',
    });
  });
});

describe('ssiDateFields', () => {
  it('matches the Python to_ssi_payload output for the real dctool fixture', () => {
    // .venv/bin/python -c "from shearwater_dive_decoder import parse_dctool_xml;
    //   from shearwater_transformers import to_ssi_payload; ..." on
    //   tests/fixtures/dive_2070684351785241573.dctool.xml gives:
    expect(ssiDateFields('2026-07-28T12:26:13-04:00')).toEqual({
      datetime: '2026-07-28 12:26',
      date: '2026-07-28',
      entry_time: '12:26',
      dive_ref: '2026-07-28T12:26:13.000-04:00_0',
    });
  });

  it('keeps the wall-clock components as stated (no UTC / host-TZ shift)', () => {
    expect(ssiDateFields('2026-01-01T23:45:07+09:30')).toEqual({
      datetime: '2026-01-01 23:45',
      date: '2026-01-01',
      entry_time: '23:45',
      dive_ref: '2026-01-01T23:45:07.000+09:30_0',
    });
  });

  it('normalises a "Z" offset to "+00:00" (Python UTC isoformat form)', () => {
    expect(ssiDateFields('2026-01-01T00:00:00Z').dive_ref).toBe('2026-01-01T00:00:00.000+00:00_0');
  });

  it('tolerates a sub-second part in the input', () => {
    expect(ssiDateFields('2026-07-28T12:26:13.500-04:00').dive_ref).toBe(
      '2026-07-28T12:26:13.000-04:00_0',
    );
  });

  it('rejects a string with no offset', () => {
    expect(() => ssiDateFields('2026-07-28T12:26:13')).toThrow();
  });
});
