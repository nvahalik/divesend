// NEW coverage for the shearwater_xml_convert.py port (the Python module has
// no tests). Exercises the documented Cloud-XML format against a hand-built
// minimal fixture; expected values are computed by hand from the Python logic
// (round-half-to-even throughout) and asserted exactly.
//
// Fixture design (cli/test/fixtures/shearwater_cloud_min.xml), imperial units:
//   header: maxDepth 60 ft, maxTime 1830 s, startDate 07/28/2026 01:30:00 PM,
//           product 8 (Teric), gfMin/gfMax 85, serial 1234567, fw 92,
//           startCns 0, endCns 3
//   4 records @ 0/60/120/180 s:
//     #1 descending  10 ft, 78 F, ndl 99, 3000 psi, firstStop 0
//     #2 at depth    59 ft, 75 F, ndl 15, 2800 psi, firstStop 0
//     #3 ascending   25 ft, 75 F, ndl 25, 2600 psi, firstStop 10  (fast -> alarm)
//     #4 shallow      2 ft, 76 F, ndl 99, 2500 psi, firstStop 0   (fast -> alarm)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  parseShearwaterXml,
  convertToSsiPayload,
  buildSamples,
} from '../../src/converters/shearwaterXml.js';

const FIXTURE = fileURLToPath(new URL('../fixtures/shearwater_cloud_min.xml', import.meta.url));
const xml = () => readFileSync(FIXTURE, 'utf8');

const DIVE = 0x08000000;
const SURFACED = 0x04000000;

describe('parseShearwaterXml', () => {
  it('patches the bogus utf-16 declaration and reads header + records', () => {
    const { header, records } = parseShearwaterXml(xml());
    expect(header.imperialUnits).toBe('true');
    expect(header.maxDepth).toBe('60');
    expect(header.startDate).toBe('07/28/2026 01:30:00 PM');
    expect(records.length).toBe(4);
    expect(records[0].currentDepth).toBe('10');
    expect(records[2].firstStopDepth).toBe('10');
  });
});

describe('convertToSsiPayload — hand-computed expected values', () => {
  const p = convertToSsiPayload(parseShearwaterXml(xml()));

  it('header scalars', () => {
    expect(p.odin_user_log_datetime).toBe('2026-07-28 13:30');
    expect(p.odin_user_log_date).toBe('2026-07-28');
    expect(p.odin_user_log_entry_time).toBe('13:30');
    expect(p.odin_user_log_depth_m).toBe(18.3); // 60 ft -> 18.288 m -> 18.3
    expect(p.odin_user_log_depth_ft).toBe(60);
    expect(p.odin_user_log_avg_depth_m).toBe(7.3);
    expect(p.odin_user_log_avg_depth_ft).toBe(24);
    expect(p.odin_user_log_divetime).toBe(30); // round(1830/60) = round(30.5) -> 30 (half-to-even)
    expect(p.odin_user_log_cns_start).toBe(0);
    expect(p.odin_user_log_cns_end).toBe(3);
    expect(p.odin_user_log_gf_set).toBe('85 / 85');
    expect(p.odin_user_log_gf_set_1).toBe(85);
    expect(p.odin_user_log_gf_set_2).toBe(85);
    expect(p.odin_user_log_divecomputer_manufacturer).toBe('Shearwater');
    expect(p.odin_user_log_divecomputer_name).toBe('Teric');
    expect(p.odin_user_log_divecomputer_serial_nr).toBe('1234567');
    expect(p.odin_user_log_divecomputer_firmware).toBe('92');
    expect(p.odin_user_log_divecomputer_dive_ref).toBe('2026-07-28T13:30:00.000_0');
    expect(p.odin_user_log_divecomputer_imported).toBe(true);
  });

  it('ean is 0 for a plain-air (fractionO2 0.21) dive', () => {
    expect(p.odin_user_log_ean).toBe(0);
    expect(p.odin_user_log_ean_percent).toBe(0);
  });

  it('imperial -> metric temperature extremes', () => {
    expect(p.odin_user_log_watertemp_c).toBe(23.9);
    expect(p.odin_user_log_watertemp_f).toBe(75);
    expect(p.odin_user_log_watertemp_max_c).toBe(25.6);
    expect(p.odin_user_log_watertemp_max_f).toBe(78.1);
  });

  it('imperial (psi) -> bar tank pressures', () => {
    expect(p.odin_user_log_pressure_start_bar).toBe(206.84);
    expect(p.odin_user_log_pressure_start_psi).toBe(3000);
    expect(p.odin_user_log_pressure_end_bar).toBe(172.37);
    expect(p.odin_user_log_pressure_end_psi).toBe(2500);
  });

  it('depth / temp / gf datasets', () => {
    expect(JSON.parse(p.odin_user_log_depthDataset as string)).toEqual([3.05, 17.98, 7.62, 0.61]);
    expect(JSON.parse(p.odin_user_log_tempDataset as string)).toEqual([25.6, 23.9, 23.9, 24.4]);
    expect(JSON.parse(p.odin_user_log_gfSurfDataset as string)).toEqual([0, 0, 0, 0]);
    expect(JSON.parse(p.odin_user_log_tankPressureDataset as string)).toEqual([
      206.84, 193.05, 179.26, 172.37,
    ]);
  });

  it('forced-double serialization keeps whole-number floats as "N.0"', () => {
    const raw = p.odin_user_log_diveSamples as string;
    expect(raw).toContain('"s":0.0');
    expect(raw).toContain('"s":7.0');
    expect(raw).toContain('"gs":0.0');
    expect(raw).toContain('"gn":0.0');
    expect(raw).toContain('"rv":3.0');
    expect(p.odin_user_log_gfSurfDataset).toBe('[0.0,0.0,0.0,0.0]');
  });

  it('diveSamples: sign of `s`, mf phase bits, alarms', () => {
    const s = JSON.parse(p.odin_user_log_diveSamples as string);
    expect(s.length).toBe(4);

    expect(s[0].n).toBe(1);
    expect(s[0].t).toBe(0);
    expect(s[0].d).toBe(3.05);
    expect(s[0].s).toBe(0);
    expect(s[0].te).toBe(25.6);
    expect(s[0].ndl).toBe(99);
    expect(s[0].a).toBe(0);
    expect(s[0].pressure).toBe(206.84);
    expect(s[0].dr).toBe(false);

    // descending -> negative ascent speed; ascending -> positive
    expect(s[1].s).toBe(-14.9);
    expect(s[1].ndl).toBe(15);
    expect(s[2].s).toBe(10.4);

    // #3 owes a stop (firstStopDepth 10)
    expect(s[2].dr).toBe(true);
    expect(s[3].dr).toBe(false);

    // mf: all "DIVE"; only the 0.61 m sample also gets "SURFACED"
    expect(s[0].mf & DIVE).toBeTruthy();
    expect(s[0].mf & SURFACED).toBeFalsy();
    expect(s[3].mf & SURFACED).toBeTruthy();

    // fast ascents on #3 (10.4 m/min) and #4 (7.0 m/min): ADVISORY|WARNING = 6
    expect(s[2].a).toBe(6);
    expect(s[3].a).toBe(6);
  });

  it('alarmDataset holds only the two fast-ascent samples', () => {
    const alarms = JSON.parse(p.odin_user_log_alarmDataset as string);
    expect(alarms).toEqual([
      { position: 3, speed: true, fast_ascent: true, deco: false, violation: false },
      { position: 4, speed: true, fast_ascent: true, deco: false, violation: false },
    ]);
  });
});

describe('nitrox path (fractionO2 > 0.22)', () => {
  it('sets ean / ean_percent from the first record', () => {
    const parsed = parseShearwaterXml(xml());
    parsed.records[0].fractionO2 = '0.32';
    const p = convertToSsiPayload(parsed);
    expect(p.odin_user_log_ean).toBe(1);
    expect(p.odin_user_log_ean_percent).toBe(32);
  });
});

describe('buildSamples — metric (non-imperial) passthrough', () => {
  it('leaves depth/temp/pressure unconverted when imperial is false', () => {
    const recs = [
      { currentTime: '0', currentDepth: '12.5', waterTemp: '18.0', currentNdl: '99', tank0pressurePSI: '200.0', firstStopDepth: '0' },
      { currentTime: '30000', currentDepth: '12.0', waterTemp: '18.0', currentNdl: '99', tank0pressurePSI: '195.0', firstStopDepth: '0' },
    ];
    const s = buildSamples(recs, false);
    expect(s[0].d).toBe(12.5);
    expect(s[0].te).toBe(18);
    expect(s[0].pressure).toBe(200);
    // (12.5 - 12.0) / (30/60 min) = 1.0 m/min ascent
    expect(s[1].s).toBe(1);
  });
});
