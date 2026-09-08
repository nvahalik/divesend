// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The engine module graph (webble.ts → window.Module) is heavy; mock the two
// engine deps so this test can drive startDownload()'s control flow directly.
// vi.hoisted() so the mock objects exist when the hoisted vi.mock factories run.
const { diag, webble } = vi.hoisted(() => ({
  diag: {
    startAttempt: vi.fn(() => 'DVS-TEST-0000'),
    markStage: vi.fn(),
    setAttemptDevice: vi.fn(),
    setAttemptDeviceName: vi.fn(),
    finishAttempt: vi.fn(),
    pushDiagLog: vi.fn(),
  },
  webble: {
    waitForEngineReady: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
    installTransport: vi.fn().mockResolvedValue(undefined),
    openTransport: vi.fn().mockResolvedValue(0),
    openDevice: vi.fn().mockResolvedValue(0),
    deviceMatchIsFallback: vi.fn(() => false),
    getDeviceVendor: vi.fn(() => 'Shearwater'),
    getDeviceProduct: vi.fn(() => 'Perdix'),
    getDeviceSerialHex: vi.fn(() => ''),
    downloadNewDives: vi.fn().mockResolvedValue(0),
    getLatestFingerprintHex: vi.fn(() => ''),
    setDiveCallbacks: vi.fn(),
    setProgressCallback: vi.fn(),
    setLogCallback: vi.fn(),
    FINGERPRINT_STORAGE_PREFIX: 'webble-fingerprint-',
  },
}));
vi.mock('./diagnostics', () => diag);
vi.mock('./webble', () => webble);
vi.mock('../db/db', () => ({ upsertDive: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./deviceSyncHistory', () => ({ recordDeviceSync: vi.fn(), getDeviceSyncRecord: vi.fn(() => null) }));

import { startDownload } from './downloadSession';

beforeEach(() => {
  vi.clearAllMocks();
  const device = { id: 'dev-1', name: "Jane's Perdix", gatt: { connect: vi.fn().mockResolvedValue({ getPrimaryService: vi.fn().mockResolvedValue({ getCharacteristic: vi.fn().mockResolvedValue({}) }) }) } };
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: vi.fn().mockResolvedValue(device) } });
});
afterEach(() => vi.unstubAllGlobals());

describe('startDownload diagnostics wiring', () => {
  it('starts and finishes exactly one attempt, registers the log callback', async () => {
    await startDownload();
    expect(diag.startAttempt).toHaveBeenCalledTimes(1);
    expect(webble.setLogCallback).toHaveBeenCalledTimes(1);
    expect(diag.setAttemptDeviceName).toHaveBeenCalledWith("Jane's Perdix");
    expect(diag.finishAttempt).toHaveBeenCalledTimes(1);
    expect(diag.finishAttempt.mock.calls[0][0]).toBe('no_new_dives');
  });

  it('maps a downloaded dive count to a success outcome', async () => {
    webble.downloadNewDives.mockResolvedValueOnce(2);
    await startDownload();
    expect(diag.finishAttempt.mock.calls[0][0]).toBe('success');
  });

  it('maps a webble_open failure to an error outcome with a token', async () => {
    webble.openTransport.mockResolvedValueOnce(-2);
    await startDownload();
    expect(diag.finishAttempt).toHaveBeenCalledTimes(1);
    expect(diag.finishAttempt.mock.calls[0][0]).toBe('error');
    expect(diag.finishAttempt.mock.calls[0][1]).toContain('webble_open');
  });

  it('maps a user-cancelled device picker to user_cancelled', async () => {
    (navigator.bluetooth!.requestDevice as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new DOMException('cancelled', 'NotFoundError'),
    );
    await startDownload();
    expect(diag.finishAttempt.mock.calls[0][0]).toBe('user_cancelled');
  });
});
