// @garmin/fitsdk ships a `types` entry (src/index.d.ts) that re-exports from a
// `src/types/` directory which is NOT included in the published tarball, so
// `Decoder` / `Stream` resolve to nothing under tsc. This local declaration
// restores the surface this converter uses. Runtime is unaffected (the JS is
// present and correct).

declare module '@garmin/fitsdk' {
  export class Stream {
    static fromByteArray(bytes: Uint8Array | number[]): Stream;
    static fromBuffer(buffer: Uint8Array): Stream;
    static fromArrayBuffer(arrayBuffer: ArrayBuffer): Stream;
  }

  export interface DecoderReadOptions {
    convertTypesToStrings?: boolean;
    convertDateTimesToDates?: boolean;
    includeUnknownData?: boolean;
    mergeHeartRates?: boolean;
    expandSubFields?: boolean;
    expandComponents?: boolean;
    applyScaleAndOffset?: boolean;
    [key: string]: unknown;
  }

  export class Decoder {
    constructor(stream: Stream);
    isFIT(): boolean;
    checkIntegrity(): boolean;
    read(options?: DecoderReadOptions): {
      messages: Record<string, any>;
      errors: unknown[];
    };
  }
}
