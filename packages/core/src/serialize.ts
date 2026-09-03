// JSON serialization that preserves int-vs-double type fidelity for SSI's
// `save_divelog` payload. SSI's server (and the iOS/Dart client this mirrors)
// re-parses the embedded dataset strings type-strictly: a whole-number double
// collapsed by plain `JSON.stringify` (6.0 -> "6") is then indistinguishable
// from an int and rejected/misread. `serializeWithForcedDoubles` renders such
// values as "6.0" wherever `isDoubleField` marks the position as a double.
//
// Lifted verbatim from payloadTransformer.ts (which mirrors
// ShearwaterSSIPayloadTransformer.swift's jsonText/jsonEncodedDouble) so the
// FIT / Shearwater / dctool converters serialize their sample + dataset strings
// the exact same way.

/**
 * Serializes a value to JSON text, forcing whole-number values to render with a
 * decimal point (e.g. 6 -> "6.0") wherever `isDoubleField` says the value at
 * that path position is semantically a double/float. Plain `JSON.stringify`
 * collapses a whole-number double to a bare integer literal, which SSI's server
 * cannot tell from an int once it re-parses -- a real, previously-confirmed bug
 * this mirrors, not a hypothetical one.
 */
export function serializeWithForcedDoubles(
  value: unknown,
  isDoubleField: (path: (string | number)[]) => boolean,
  path: (string | number)[] = [],
): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (
      isDoubleField(path) &&
      Number.isFinite(value) &&
      Math.abs(value) < 1e15 &&
      Number.isInteger(value)
    ) {
      return value.toFixed(1);
    }
    return String(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((v, i) => serializeWithForcedDoubles(v, isDoubleField, [...path, i])).join(',') + ']';
  }
  if (typeof value === 'object') {
    return (
      '{' +
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => JSON.stringify(k) + ':' + serializeWithForcedDoubles(v, isDoubleField, [...path, k]))
        .join(',') +
      '}'
    );
  }
  throw new Error(`Cannot serialize value at path ${path.join('.')}`);
}

/**
 * Sample-object keys whose values are semantically doubles in an SSI dive
 * sample (`n`, `t`, `ndl`, `a`, `mf` stay ints; `o`/`dr` are bools).
 */
export const SAMPLE_DOUBLE_FIELDS = new Set(['d', 's', 'te', 'gs', 'gn', 'rv', 'pressure']);
