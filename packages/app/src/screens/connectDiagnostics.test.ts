// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { pushDiagLog, resetDiagLog, startAttempt } from '../engine/diagnostics';
import { buildDiagnosticsBlob, copyDiagnostics } from './connectDiagnostics';

afterEach(() => vi.unstubAllGlobals());

describe('buildDiagnosticsBlob', () => {
  it('produces text with the code and a dated .txt filename', () => {
    resetDiagLog();
    const code = startAttempt();
    pushDiagLog('dc', 'handshake byte 0x40', '4');
    const { text, filename } = buildDiagnosticsBlob();
    expect(text).toContain(code);
    expect(text).toContain('handshake byte 0x40');
    expect(filename).toMatch(/^divesend-diagnostics-DVS-[0-9A-HJKMNP-TV-Z-]+-\d{4}-\d{2}-\d{2}T/);
    expect(filename.endsWith('.txt')).toBe(true);
  });
});

describe('copyDiagnostics', () => {
  it('writes the diagnostics text to the clipboard and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'test' });
    resetDiagLog();
    startAttempt();
    const ok = await copyDiagnostics();
    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String(writeText.mock.calls[0][0])).toContain('DiveSend connect diagnostics');
  });

  it('returns false when the clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', { userAgent: 'test' });
    resetDiagLog();
    startAttempt();
    expect(await copyDiagnostics()).toBe(false);
  });
});
