import { describe, it, expect } from 'vitest';
import { resolveModel, productFromFilename } from '../src/model.js';
import { CliError } from '../src/io.js';

describe('productFromFilename', () => {
  it('pulls the product from the app\'s raw-file naming', () => {
    expect(productFromFilename('/x/y/Teric-2026-07-30T19-07-51Z.bin')).toBe('Teric');
  });
  it('handles a bare filename and a Windows path', () => {
    expect(productFromFilename('Teric-2026-07-30T19-07-51Z.bin')).toBe('Teric');
    expect(productFromFilename('C:\\dl\\Perdix 2-2026-01-02T03-04-05Z.bin')).toBe('Perdix 2');
  });
  it('returns null when there is no name or no year marker to split on', () => {
    expect(productFromFilename(undefined)).toBeNull();
    expect(productFromFilename('/x/rawdump.bin')).toBe('rawdump'); // no -YYYY -> whole stem
    expect(productFromFilename('/x/.bin')).toBeNull();
  });
});

describe('resolveModel', () => {
  it('takes the whole --model string as the product, vendor empty', () => {
    expect(resolveModel({ model: 'Teric' })).toEqual({ vendor: '', product: 'Teric' });
    expect(resolveModel({ model: '  Perdix 2 ' })).toEqual({ vendor: '', product: 'Perdix 2' });
  });
  it('falls back to the filename when --model is absent', () => {
    expect(resolveModel({ filePath: '/d/Teric-2026-07-30T19-07-51Z.bin' }))
      .toEqual({ vendor: '', product: 'Teric' });
  });
  it('prefers --model over the filename', () => {
    expect(resolveModel({ model: 'Peregrine', filePath: '/d/Teric-2026-01-01T00-00-00Z.bin' }))
      .toEqual({ vendor: '', product: 'Peregrine' });
  });
  it('throws a CliError when neither yields a product', () => {
    expect(() => resolveModel({})).toThrow(CliError);
    expect(() => resolveModel({})).toThrow('Could not determine the dive computer model');
  });
});
