// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLogCallback } from './webble';

describe('setLogCallback', () => {
  beforeEach(() => {
    // installTransport() is what normally creates Module.webble; stub the
    // shape it produces so setLogCallback has something to write onto.
    (window as unknown as { Module: { webble: Record<string, unknown> } }).Module = {
      webble: { onLog: () => {} },
    };
  });

  it('routes engine log lines to the registered callback', () => {
    const seen: Array<[number, string]> = [];
    setLogCallback((level, line) => seen.push([level, line]));

    const mod = (window as unknown as { Module: { webble: { onLog: (l: number, s: string) => void } } }).Module;
    mod.webble.onLog(3, '[INFO] shearwater_common_download: hello');

    expect(seen).toEqual([[3, '[INFO] shearwater_common_download: hello']]);
  });

  it('is overwritten, not appended, by a second registration', () => {
    const first = vi.fn();
    const second = vi.fn();
    setLogCallback(first);
    setLogCallback(second);

    const mod = (window as unknown as { Module: { webble: { onLog: (l: number, s: string) => void } } }).Module;
    mod.webble.onLog(1, 'x');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(1, 'x');
  });
});
