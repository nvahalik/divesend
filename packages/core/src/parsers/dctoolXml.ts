// Semantic port of shearwater_dive_decoder.parse_dctool_xml (+ its
// _parse_dctool_datetime / _parse_mmss_to_seconds helpers).
//
// libdivecomputer's `dctool parse` emits an XML dive schema. The Python
// reference parses it into its own `CanonicalDive` dataclass; this port
// instead targets `@divesend/core`'s `CanonicalDive` shape (the
// WASM-aligned camelCase field names) so the result feeds `transformDive`
// (payloadTransformer) and `toUddf` directly.
//
// Field mapping (dctool XML -> core CanonicalDive):
//   dive/datetime            -> header.startTime   (ISO 8601, original offset kept)
//   dive/maxdepth            -> header.maxDepthM
//   dive/gasmix/o2           -> header.gasO2Percent
//   dive/gasmix/he           -> header.gasHePercent
//   dive/tank/beginpressure  -> header.tankBeginPressureBar
//   dive/tank/endpressure    -> header.tankEndPressureBar
//   dive/divemode            -> header.diveMode
//   dive/decomodel           -> header.decoModel
//   dive/gf ("low/high")     -> header.gfLow / header.gfHigh
//   dive/salinity            -> header.salinity
//   dive/divetime ("mm:ss")  -> header.divetimeS   (NEW: the Python dataclass
//                               has no divetime field and drops this; the
//                               core shape has divetimeS, so it wins.)
//   (hardcoded)              -> header.deviceModel = "Teric"  (matches the
//                               Python DiveHeader default)
//   header.minTemperatureC / maxTemperatureC / cnsPercent -> null (dctool XML
//     carries no firmware-tracked extremes / header CNS; payloadTransformer
//     falls back to scanning the profile samples)
//
//   sample/time ("mm:ss")    -> samples[].timeS
//   sample/depth             -> samples[].depthM
//   sample/temperature       -> samples[].tempC          (null when absent)
//   sample/deco@time         -> samples[].ndlS           (null when no <deco>)
//   sample/deco@depth        -> samples[].decoStopDepthM (null when no <deco>)
//   sample/pressure          -> samples[].tankPressureBar (null when absent)
//   sample/tts               -> samples[].ttsS           (null when absent)
//
// Dropped (both the Python reference and the core shape lack a home for
// these): per-sample <cns>, per-sample <gasmix>, dive <number>, <size>,
// <atmospheric>, <salinity density=> attr, <gasmix><n2>.

import { XMLParser } from 'fast-xml-parser';
import type { CanonicalDive, DiveHeader, DiveSample } from '../types.js';

/** Port of `_parse_mmss_to_seconds`. */
export function parseMmssToSeconds(text: string): number {
  const [minutes, seconds] = text.split(':');
  return parseInt(minutes, 10) * 60 + parseInt(seconds, 10);
}

/**
 * Port of `_parse_dctool_datetime`. Python parses
 * "2026-07-28 12:26:13 -04:00" into a tz-aware `datetime`; here we
 * normalise it to an ISO 8601 string that keeps the original UTC offset
 * (so `toUddf`'s `isoformat(timespec="seconds")` equivalent round-trips).
 */
export function parseDctoolDatetime(text: string): string {
  const m = text
    .trim()
    .match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-]\d{2}:?\d{2}|Z)$/);
  if (!m) {
    throw new Error(`unrecognised dctool datetime: ${JSON.stringify(text)}`);
  }
  let offset = m[3];
  if (offset !== 'Z' && !offset.includes(':')) {
    offset = `${offset.slice(0, 3)}:${offset.slice(3)}`;
  }
  return `${m[1]}T${m[2]}${offset}`;
}

class DctoolParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DctoolParseError';
  }
}

/** Element text that may be a bare string or an attributed `{ '#text': ... }`. */
function elText(node: unknown): string | undefined {
  if (node == null) return undefined;
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    return t == null ? undefined : String(t);
  }
  return String(node);
}

function req(node: unknown, what: string): string {
  const t = elText(node);
  if (t === undefined) throw new DctoolParseError(`missing <${what}>`);
  return t;
}

interface DecoAttrs {
  '@_time'?: string;
  '@_depth'?: string;
}

/** Semantic port of `parse_dctool_xml`. */
export function parseDctoolXml(xmlText: string): CanonicalDive {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    parseAttributeValue: false,
    attributeNamePrefix: '@_',
    isArray: (name) => name === 'sample',
  });

  let root: Record<string, any>;
  try {
    root = parser.parse(xmlText);
  } catch (exc) {
    throw new DctoolParseError(`XML parse failed: ${(exc as Error).message}`);
  }

  const dive = root?.device?.dive ?? root?.dive;
  if (!dive) throw new DctoolParseError('no <dive> element');

  const gasmix = dive.gasmix ?? {};
  const tank = dive.tank ?? {};
  const [gfLowRaw, gfHighRaw] = req(dive.gf, 'gf').split('/');

  const header: DiveHeader = {
    startTime: parseDctoolDatetime(req(dive.datetime, 'datetime')),
    maxDepthM: parseFloat(req(dive.maxdepth, 'maxdepth')),
    gasO2Percent: parseFloat(req(gasmix.o2, 'gasmix/o2')),
    gasHePercent: parseFloat(req(gasmix.he, 'gasmix/he')),
    tankBeginPressureBar: parseFloat(req(tank.beginpressure, 'tank/beginpressure')),
    tankEndPressureBar: parseFloat(req(tank.endpressure, 'tank/endpressure')),
    diveMode: req(dive.divemode, 'divemode'),
    decoModel: req(dive.decomodel, 'decomodel'),
    gfLow: parseInt(gfLowRaw, 10),
    gfHigh: parseInt(gfHighRaw, 10),
    salinity: req(dive.salinity, 'salinity'),
    deviceModel: 'Teric',
    divetimeS: parseMmssToSeconds(req(dive.divetime, 'divetime')),
    minTemperatureC: null,
    maxTemperatureC: null,
    cnsPercent: null,
  };

  const rawSamples: Record<string, any>[] = dive.sample ?? [];
  const samples: DiveSample[] = rawSamples.map((s) => {
    const deco = s.deco as DecoAttrs | undefined;
    const tempT = elText(s.temperature);
    const pressureT = elText(s.pressure);
    const ttsT = elText(s.tts);
    return {
      timeS: parseMmssToSeconds(req(s.time, 'sample/time')),
      depthM: parseFloat(req(s.depth, 'sample/depth')),
      tempC: tempT !== undefined ? parseFloat(tempT) : null,
      ndlS: deco !== undefined && deco['@_time'] !== undefined ? parseInt(deco['@_time'], 10) : null,
      tankPressureBar: pressureT !== undefined ? parseFloat(pressureT) : null,
      decoStopDepthM:
        deco !== undefined && deco['@_depth'] !== undefined ? parseFloat(deco['@_depth']) : null,
      ttsS: ttsT !== undefined ? parseInt(ttsT, 10) : null,
    };
  });

  return { header, samples };
}

export { DctoolParseError };
