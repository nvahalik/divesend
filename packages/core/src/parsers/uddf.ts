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

import { BAR_TO_PA, KELVIN_OFFSET, roundHalfToEven } from '../units.js';
import type { CanonicalDive } from '../types.js';

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
