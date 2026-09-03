// The SSI dive-sample shape used in a `save_divelog` payload's sample dataset.
// Lifted from payloadTransformer.ts's inline `interface SSISample` so every
// converter (FIT, Shearwater XML, dctool) and `alarmDataset` share one type.

export interface SsiSample {
  n: number;
  t: number;
  d: number;
  s: number;
  te: number | null;
  ndl: number | null;
  gs: number;
  gn: number;
  a: number;
  mf: number;
  o: boolean;
  dr: boolean;
  rv: number;
  pressure?: number;
}
