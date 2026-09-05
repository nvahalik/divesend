// app/src/export/diveExportFilename.ts

/**
 * Builds a download filename for an exported dive from its ISO start date,
 * e.g. "2026-07-28T12-26-00.uddf" -- colons aren't valid in filenames on
 * most platforms, so they're swapped for dashes.
 */
export function diveExportFileName(date: string, extension: string): string {
  const safeDate = date.replace(/:/g, '-');
  return `${safeDate}.${extension}`;
}
