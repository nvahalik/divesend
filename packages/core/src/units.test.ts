import { describe, it, expect } from 'vitest';
import { roundHalfToEven, FT_TO_M, SEMICIRCLE_TO_DEG } from './units';

describe('roundHalfToEven', () => {
  it('rounds half to even', () => {
    expect(roundHalfToEven(194.5)).toBe(194);
    expect(roundHalfToEven(195.5)).toBe(196);
    expect(roundHalfToEven(2.5)).toBe(2);
    expect(roundHalfToEven(-2.5)).toBe(-2);
    expect(roundHalfToEven(1.2345, 2)).toBe(1.23);
    expect(roundHalfToEven(1.2355, 3)).toBe(1.236);
    expect(roundHalfToEven(1000000.5)).toBe(1000000);
  });
  it('leaves non-half values alone', () => {
    expect(roundHalfToEven(194.4)).toBe(194);
    expect(roundHalfToEven(194.6)).toBe(195);
  });
});

it('unit constants', () => {
  expect(FT_TO_M).toBe(0.3048);
  expect(SEMICIRCLE_TO_DEG).toBeCloseTo(8.381903171539306e-8, 20);
});
