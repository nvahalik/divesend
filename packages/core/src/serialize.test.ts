import { describe, it, expect } from 'vitest';
import { serializeWithForcedDoubles, SAMPLE_DOUBLE_FIELDS } from './serialize.js';

describe('serializeWithForcedDoubles', () => {
  it('forces whole-number double fields to render with a decimal point', () => {
    const out = serializeWithForcedDoubles(
      [{ s: -15, gs: 0, n: 1, o: false }],
      (path) => typeof path[1] === 'string' && SAMPLE_DOUBLE_FIELDS.has(path[1] as string),
    );
    expect(out).toBe('[{"s":-15.0,"gs":0.0,"n":1,"o":false}]');
  });

  it('forces every element of a dataset array when isDoubleField is always true', () => {
    expect(serializeWithForcedDoubles([0, 0, 3], () => true)).toBe('[0.0,0.0,3.0]');
  });

  it('leaves non-integer doubles and nulls alone', () => {
    expect(serializeWithForcedDoubles([1.31, null, 27.4], () => true)).toBe('[1.31,null,27.4]');
  });

  it('SAMPLE_DOUBLE_FIELDS is the sample float set', () => {
    expect([...SAMPLE_DOUBLE_FIELDS].sort()).toEqual(['d', 'gn', 'gs', 'pressure', 'rv', 's', 'te']);
  });
});
