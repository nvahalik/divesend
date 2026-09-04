// Port of shearwater_transformers.to_uddf(dive: CanonicalDive) -> str.
//
// The Python builds the tree with xml.etree.ElementTree and serialises with
// `ET.tostring(..., encoding="unicode")`; this port builds the same element
// structure by string concatenation (the elements are all fixed and shallow).
// Numeric text is rendered to match Python's `str(float)` / `str(int)`:
// whole-valued floats keep a trailing ".0" (e.g. `str(0.0)` -> "0.0"), ints
// don't (`str(5)` -> "5").
//
// `BAR_TO_PA` / `KELVIN_OFFSET` come from `@divesend/core`.

import { XMLParser } from 'fast-xml-parser';
import { BAR_TO_PA, KELVIN_OFFSET, roundHalfToEven } from '../units.js';
import type { CanonicalDive, DiveHeader, DiveSample } from '../types.js';

const UDDF_NS = 'http://www.streit.cc/uddf/3.2/';

/** Mimic Python `str(float)`: integral values render with a trailing ".0". */
function pyFloat(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Python `datetime.isoformat(timespec="seconds")` — drop any sub-second part. */
function isoSeconds(iso: string): string {
  return iso.replace(/\.\d+/, '');
}

/** Port of `to_uddf`. */
export function toUddf(dive: CanonicalDive): string {
  const header = dive.header;
  const beginBar = header.tankBeginPressureBar ?? 0;
  const endBar = header.tankEndPressureBar ?? 0;

  const parts: string[] = [];
  parts.push(`<uddf version="3.2.3" xmlns="${UDDF_NS}">`);
  parts.push(`<generator><name>divesend</name></generator>`);
  parts.push(
    `<diver><owner><equipment>` +
      `<divecomputer id="computer1"><model>${xmlEscape(header.deviceModel)}</model></divecomputer>` +
      `</equipment></owner></diver>`,
  );
  parts.push(
    `<gasdefinitions><mix id="mix1">` +
      `<o2>${pyFloat(header.gasO2Percent / 100)}</o2>` +
      `<he>${pyFloat(header.gasHePercent / 100)}</he>` +
      `</mix></gasdefinitions>`,
  );
  parts.push(
    `<decomodel><buehlmann id="zhl16c">` +
      `<gradientfactorlow>${header.gfLow}</gradientfactorlow>` +
      `<gradientfactorhigh>${header.gfHigh}</gradientfactorhigh>` +
      `</buehlmann></decomodel>`,
  );

  parts.push(`<profiledata><repetitiongroup><dive>`);
  parts.push(
    `<informationbeforedive><datetime>${isoSeconds(header.startTime)}</datetime></informationbeforedive>`,
  );
  parts.push(
    `<tankdata>` +
      `<tankpressurebegin>${pyFloat(beginBar * BAR_TO_PA)}</tankpressurebegin>` +
      `<tankpressureend>${pyFloat(endBar * BAR_TO_PA)}</tankpressureend>` +
      `</tankdata>`,
  );

  parts.push(`<samples>`);
  for (const s of dive.samples) {
    let wp = `<waypoint><depth>${pyFloat(s.depthM)}</depth><divetime>${s.timeS}</divetime>`;
    if (s.tempC != null) {
      wp += `<temperature>${pyFloat(roundHalfToEven(s.tempC + KELVIN_OFFSET, 2))}</temperature>`;
    }
    if (s.tankPressureBar != null) {
      wp += `<tankpressure ref="mix1">${pyFloat(s.tankPressureBar * BAR_TO_PA)}</tankpressure>`;
    }
    wp += `</waypoint>`;
    parts.push(wp);
  }
  parts.push(`</samples>`);

  parts.push(`</dive></repetitiongroup></profiledata>`);
  parts.push(`</uddf>`);

  return parts.join('');
}

// --- parseUddf: Shearwater Cloud Desktop UDDF reader ---------------------------

export class UddfParseError extends Error {}

const UDDF_ARRAY_TAGS = new Set([
  'repetitiongroup',
  'dive',
  'waypoint',
  'tankdata',
  'divecomputer',
  'mix',
  'para',
]);

const uddfXmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => UDDF_ARRAY_TAGS.has(name),
});

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Extract element text whether the node is a bare value or `{ '#text': v, '@_ref': ... }`. */
function textOf(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    return t == null ? null : String(t).trim();
  }
  return String(v).trim();
}

function numOf(v: unknown): number | null {
  const t = textOf(v);
  if (t == null || t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Reject tag names that carry a namespace prefix, e.g. `foo:dive` (colons in
 *  attribute VALUES, like mix id="OC1:21/00", are unaffected — this only
 *  walks structural object keys). */
function assertNoNamespacedTags(node: unknown): void {
  if (node == null || typeof node !== 'object') return;
  for (const key of Object.keys(node as Record<string, unknown>)) {
    if (!key.startsWith('@_') && key !== '#text' && key.includes(':')) {
      throw new UddfParseError(`Namespaced tag name not supported: ${key}`);
    }
    assertNoNamespacedTags((node as Record<string, unknown>)[key]);
  }
}

const DIVE_MODE_MAP: Record<string, string> = {
  opencircuit: 'oc',
  closedcircuit: 'ccr',
  semiclosedcircuit: 'scr',
  apnea: 'freedive',
  gauge: 'gauge',
};

export function parseUddf(xmlText: string): CanonicalDive[] {
  let root: any;
  try {
    root = uddfXmlParser.parse(xmlText);
  } catch (err) {
    throw new UddfParseError(`Failed to parse UDDF XML: ${(err as Error).message}`);
  }

  const uddf = root?.uddf;
  if (uddf == null || typeof uddf !== 'object') {
    throw new UddfParseError('Root element is not <uddf>.');
  }
  assertNoNamespacedTags(root);

  // decomodel (document-level)
  const decomodel = uddf.decomodel;
  const buehlmann = decomodel?.buehlmann ?? decomodel?.buhlmann;
  let decoModel = 'buhlmann';
  if (decomodel != null) {
    if (buehlmann != null) decoModel = 'buhlmann';
    else if (decomodel.vpm != null) decoModel = 'vpm';
    else decoModel = 'none';
  }
  const gfLow = buehlmann != null ? (numOf(buehlmann.gradientfactorlow) ?? 0) : 0;
  const gfHigh = buehlmann != null ? (numOf(buehlmann.gradientfactorhigh) ?? 0) : 0;

  // gasdefinitions (document-level)
  const mixes = asArray(uddf.gasdefinitions?.mix);
  const mixById = new Map<string, { o2: number; he: number }>();
  for (const mix of mixes) {
    const id = mix?.['@_id'];
    if (id == null) continue;
    const o2 = numOf(mix.o2) ?? 0;
    const he = numOf(mix.he) ?? 0;
    mixById.set(String(id), { o2, he });
  }

  // divecomputers (document-level)
  const divecomputers = asArray(uddf.diver?.owner?.equipment?.divecomputer);

  const repetitionGroups = asArray(uddf.profiledata?.repetitiongroup);
  const diveEls = repetitionGroups.flatMap((rg: any) => asArray(rg?.dive));

  if (diveEls.length === 0) {
    throw new UddfParseError('No <dive> elements found.');
  }

  const dives: CanonicalDive[] = [];

  for (const diveEl of diveEls) {
    const startTime = textOf(diveEl?.informationbeforedive?.datetime);
    if (startTime == null) {
      throw new UddfParseError('A <dive> is missing informationbeforedive > datetime.');
    }

    const waypoints = asArray(diveEl?.samples?.waypoint);

    // samples
    const samples: DiveSample[] = waypoints.map((wp: any) => {
      const timeS = numOf(wp?.divetime) ?? 0;
      const depthM = numOf(wp?.depth) ?? 0;
      const tempK = numOf(wp?.temperature);
      const tempC = tempK != null ? tempK - KELVIN_OFFSET : null;
      const tankPressurePa = numOf(wp?.tankpressure);
      const tankPressureBar = tankPressurePa != null ? tankPressurePa / BAR_TO_PA : null;
      const ndlS = numOf(wp?.nodecotime);
      return {
        timeS,
        depthM,
        tempC,
        ndlS,
        tankPressureBar,
        decoStopDepthM: null,
        ttsS: null,
      };
    });

    // header: divetimeS / maxDepthM, with waypoint fallbacks
    let divetimeS = numOf(diveEl?.informationafterdive?.diveduration);
    if (divetimeS == null && waypoints.length > 0) {
      divetimeS = samples[samples.length - 1]?.timeS ?? 0;
    }
    divetimeS = divetimeS ?? 0;

    let maxDepthM = numOf(diveEl?.informationafterdive?.greatestdepth);
    if (maxDepthM == null && samples.length > 0) {
      maxDepthM = Math.max(...samples.map((s) => s.depthM));
    }
    maxDepthM = maxDepthM ?? 0;

    // temperature range
    const temps = samples.map((s) => s.tempC).filter((t): t is number => t != null);
    const minTemperatureC = temps.length > 0 ? Math.min(...temps) : null;
    const maxTemperatureC = temps.length > 0 ? Math.max(...temps) : null;

    // dive mode: first waypoint's divemode @type
    let diveMode = 'oc';
    for (const wp of waypoints) {
      const type = wp?.divemode?.['@_type'];
      if (type != null) {
        diveMode = DIVE_MODE_MAP[String(type)] ?? 'oc';
        break;
      }
    }

    // active gas mix: first waypoint's switchmix @ref
    let gasO2Percent = 21;
    let gasHePercent = 0;
    for (const wp of waypoints) {
      const ref = wp?.switchmix?.['@_ref'];
      if (ref != null) {
        const mix = mixById.get(String(ref));
        if (mix != null) {
          gasO2Percent = mix.o2 * 100;
          gasHePercent = mix.he * 100;
        }
        break;
      }
    }

    // tank pressures: first <tankdata>
    const tankDataEls = asArray(diveEl?.tankdata);
    const firstTank = tankDataEls[0];
    const tankBeginPa = firstTank != null ? numOf(firstTank.tankpressurebegin) : null;
    const tankEndPa = firstTank != null ? numOf(firstTank.tankpressureend) : null;
    const tankBeginPressureBar = tankBeginPa != null ? tankBeginPa / BAR_TO_PA : null;
    const tankEndPressureBar = tankEndPa != null ? tankEndPa / BAR_TO_PA : null;

    // device model: match equipmentused link ref against divecomputer @id, else first
    const equipRef = diveEl?.informationbeforedive?.equipmentused?.link?.['@_ref'];
    let deviceModel = 'Unknown';
    if (divecomputers.length > 0) {
      let dc = divecomputers[0];
      if (equipRef != null) {
        const matched = divecomputers.find((d: any) => String(d?.['@_id']) === String(equipRef));
        if (matched != null) dc = matched;
      }
      const name = textOf(dc?.name);
      if (name != null) deviceModel = name;
    }

    const cnsRaw = numOf(diveEl?.informationafterdive?.cns);
    const cnsPercent = cnsRaw != null ? cnsRaw * 100 : null;

    const header: DiveHeader = {
      startTime,
      maxDepthM,
      gasO2Percent,
      gasHePercent,
      tankBeginPressureBar,
      tankEndPressureBar,
      diveMode,
      decoModel,
      gfLow,
      gfHigh,
      salinity: 'salt',
      deviceModel,
      divetimeS,
      minTemperatureC,
      maxTemperatureC,
      cnsPercent,
    };

    dives.push({ header, samples });
  }

  return dives;
}
