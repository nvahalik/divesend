import { describe, it, expect } from 'vitest';
import { resolveBrand } from './resolveBrand';

describe('resolveBrand', () => {
  it.each([
    ['Shearwater Teric', 'shearwater'],
    ['Perdix 2', 'shearwater'],
    ['Petrel', 'shearwater'],
    ['Peregrine', 'shearwater'],
    ['Descent Mk2i', 'garmin'],
    ['Suunto D5', 'suunto'],
    ['Zoop Novo', 'suunto'],
    ['EON Steel', 'suunto'],
    ['Galileo HUD', 'scubapro'],
    ['Puck Pro', 'mares'],
    ['Leonardo', 'cressi'],
    ['i330R', 'aqualung'],
    ['OSTC 4', 'heinrichs-weikamp'],
    ['Cosmiq+', 'deepblu'],
  ])('maps %j to %j', (model, id) => {
    expect(resolveBrand(model)?.id).toBe(id);
  });

  it('returns null for empty or unknown models', () => {
    expect(resolveBrand('')).toBeNull();
    expect(resolveBrand(undefined)).toBeNull();
    expect(resolveBrand('Generic Widget 3000')).toBeNull();
  });

  it('resolves a brand with shipped assets to non-null urls', () => {
    const b = resolveBrand('Shearwater Teric');
    expect(b?.wordmark).toBeTruthy();
    expect(b?.favicon).toBeTruthy();
  });

  it('resolves Garmin (recognised make, no shipped asset) with null wordmark/favicon', () => {
    expect(resolveBrand('Descent Mk3i')).toMatchObject({
      id: 'garmin',
      name: 'Garmin',
      wordmark: null,
      favicon: null,
    });
  });

  it('resolves Scubapro with a favicon but no wordmark', () => {
    const b = resolveBrand('Galileo G2');
    expect(b?.favicon).toBeTruthy();
    expect(b?.wordmark).toBeNull();
  });
});
