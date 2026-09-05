import { describe, expect, it } from 'vitest';
import { diveExportFileName } from './diveExportFilename';

describe('diveExportFileName', () => {
  it('swaps colons for dashes and appends the extension', () => {
    expect(diveExportFileName('2026-07-28T12:26:00Z', 'uddf')).toBe('2026-07-28T12-26-00Z.uddf');
  });

  it('supports different extensions', () => {
    expect(diveExportFileName('2026-07-28T12:26:00Z', 'fit')).toBe('2026-07-28T12-26-00Z.fit');
  });
});
