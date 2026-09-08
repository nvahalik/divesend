// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// downloadSession pulls in the whole webble/WASM module graph; the screen only
// needs its store, so mock it and drive the session state by hand.
const { session } = vi.hoisted(() => ({
  session: {
    state: {
      connecting: false,
      log: [],
      progress: [] as string[],
      stage: null,
      transfer: null,
      diveCount: 0,
      totalImported: 0,
    },
  },
}));
vi.mock('../engine/downloadSession', () => ({
  useDownloadSession: () => session.state,
  startDownload: vi.fn(),
}));
vi.mock('./connectDiagnostics', () => ({
  copyDiagnostics: vi.fn().mockResolvedValue(true),
  downloadDiagnostics: vi.fn(),
}));
vi.mock('../engine/deviceSyncHistory', () => ({ listDeviceSyncHistory: () => [] }));
vi.mock('../lib/webBluetooth', () => ({ isWebBluetoothSupported: () => true }));

import {
  __resetDiagOptInCacheForTests,
  currentAttemptMeta,
  finishAttempt,
  pushDiagLog,
  resetDiagLog,
  startAttempt,
} from '../engine/diagnostics';
import { ConnectScreen } from './ConnectScreen';

describe('ConnectScreen diagnostics affordances', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    localStorage.clear();
    __resetDiagOptInCacheForTests();
    resetDiagLog();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}')));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  const failedAttempt = () => {
    startAttempt();
    pushDiagLog('js', 'Selected device');
    finishAttempt('error', 'dom:NetworkError', 0);
  };
  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label);

  it('shows the diagnostic code next to the export buttons once an attempt has run', () => {
    failedAttempt();
    act(() => root.render(<ConnectScreen />));
    expect(container.textContent).toContain(`Diagnostic code: ${currentAttemptMeta().code}`);
  });

  it('hides the diagnostic code line when no attempt has logged anything', () => {
    act(() => root.render(<ConnectScreen />));
    expect(container.textContent).not.toContain('Diagnostic code:');
  });

  it('replaces the opt-in card with a code the user can quote after Share report', () => {
    failedAttempt();
    const code = currentAttemptMeta().code;
    act(() => root.render(<ConnectScreen />));
    expect(container.textContent).toContain('Something went wrong connecting.');

    act(() => button('Share report')!.click());

    expect(container.textContent).not.toContain('Something went wrong connecting.');
    expect(container.textContent).toContain('Quote this code to support:');
    expect(container.textContent).toContain(code);
  });

  it('does not re-show the card on remount after "Not now"', () => {
    failedAttempt();
    act(() => root.render(<ConnectScreen />));
    act(() => button('Not now')!.click());
    expect(container.textContent).not.toContain('Something went wrong connecting.');

    // Navigate away and back -- this Route really does unmount.
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<ConnectScreen />));
    expect(container.textContent).not.toContain('Something went wrong connecting.');
  });

  it('re-shows the card after the NEXT failed attempt', () => {
    failedAttempt();
    act(() => root.render(<ConnectScreen />));
    act(() => button('Not now')!.click());
    expect(container.textContent).not.toContain('Something went wrong connecting.');

    failedAttempt(); // a new attempt => a new diagnostic code
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<ConnectScreen />));
    expect(container.textContent).toContain('Something went wrong connecting.');
  });
});
