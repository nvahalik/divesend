// app/src/screens/connectDiagnostics.ts
// Imperative clipboard/download plumbing behind ConnectScreen's "Copy
// diagnostics" / "Download diagnostics" actions. Split from the component so
// the DOM mechanics are unit-testable without rendering.
import {
  APP_VERSION,
  buildDiagnosticsText,
  currentAttemptMeta,
  currentTimings,
  currentUA,
  getDiagLog,
} from '../engine/diagnostics';

export function buildDiagnosticsBlob(): { text: string; filename: string } {
  const meta = currentAttemptMeta();
  const generatedAt = new Date().toISOString();
  const text = buildDiagnosticsText(
    {
      code: meta.code,
      generatedAt,
      appVersion: APP_VERSION,
      ua: currentUA(),
      vendor: meta.vendor,
      product: meta.product,
      fallbackMatch: meta.fallbackMatch,
      timings: currentTimings(),
    },
    getDiagLog(),
  );
  return { text, filename: `divesend-diagnostics-${meta.code}-${generatedAt}.txt` };
}

export async function copyDiagnostics(): Promise<boolean> {
  const { text } = buildDiagnosticsBlob();
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadDiagnostics(): void {
  const { text, filename } = buildDiagnosticsBlob();
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
