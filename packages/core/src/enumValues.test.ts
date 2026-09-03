import { describe, expect, it } from 'vitest';
import { ENUM_VALUES, sortedOptions, type EnumCategory } from './enumValues';

describe('ENUM_VALUES', () => {
  it('diveType contains expected ids', () => {
    expect(ENUM_VALUES.diveType[23]).toBe('Education');
    expect(ENUM_VALUES.diveType[24]).toBe('Fun');
    expect(ENUM_VALUES.diveType[138]).toBe('Scientific');
    expect(ENUM_VALUES.diveType[139]).toBe('Work');
  });

  it('entry contains shore/boat/other', () => {
    expect(ENUM_VALUES.entry[21]).toBe('Shore');
    expect(ENUM_VALUES.entry[22]).toBe('Boat');
    expect(ENUM_VALUES.entry[35]).toBe('Other');
  });

  it('tankType contains steel and aluminum', () => {
    expect(ENUM_VALUES.tankType[19]).toBe('Steel');
    expect(ENUM_VALUES.tankType[20]).toBe('Aluminum');
  });

  it('waterBody has 14 entries', () => {
    expect(Object.keys(ENUM_VALUES.waterBody)).toHaveLength(14);
    expect(ENUM_VALUES.waterBody[13]).toBe('Ocean');
    expect(ENUM_VALUES.waterBody[140]).toBe('Spring');
  });

  it('current has 4 entries', () => {
    expect(ENUM_VALUES.current[6]).toBe('No Current');
    expect(ENUM_VALUES.current[9]).toBe('Ripping Current');
  });

  it('weather has 4 entries', () => {
    expect(ENUM_VALUES.weather[1]).toBe('Sunny');
    expect(ENUM_VALUES.weather[121]).toBe('Snow');
  });
});

describe('sortedOptions', () => {
  it('sorts alphabetically by label', () => {
    const sorted = sortedOptions('entry');
    expect(sorted.map((o) => o.label)).toEqual(['Boat', 'Other', 'Shore']);
    expect(sorted.map((o) => o.id)).toEqual([22, 35, 21]);
  });

  it('covers every category', () => {
    const categories: EnumCategory[] = ['diveType', 'entry', 'tankType', 'waterBody', 'current', 'weather'];
    for (const category of categories) {
      expect(sortedOptions(category).length).toBe(Object.keys(ENUM_VALUES[category]).length);
    }
  });
});
