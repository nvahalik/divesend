// app/src/engine/webble.ts
// The only file in the app that touches the global Module/ccall directly.
import type { CanonicalDive } from '@divesend/core';

interface WebbleModuleWebble {
  read(maxSize: number): Promise<Uint8Array | null>;
  write(bytes: Uint8Array): Promise<boolean>;
  onDive(json: string): void;
  onDiveError(index: number, message: string): void;
}

interface WebbleModule {
  ccall(
    name: string,
    returnType: 'number' | 'string' | null,
    argTypes: string[],
    args: unknown[],
    opts?: { async?: boolean }
  ): any;
  webble: WebbleModuleWebble;
  onRuntimeInitialized?: () => void;
}

declare global {
  interface Window {
    Module: WebbleModule;
    __webbleReadyPromise: Promise<void>;
  }
}

let notificationQueue: Uint8Array[] = [];
let notificationWaiters: Array<(bytes: Uint8Array | null) => void> = [];
let notificationListener: ((event: Event) => void) | null = null;
let txCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
let rxCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;

// Asyncify (the WASM module's suspend/resume mechanism for async ccalls)
// can only have one operation in flight at a time -- starting a second
// while the first is still suspended aborts the whole module with
// "Assertion failed: We cannot start an async operation when one is
// already in flight" (seen for real: app/NOTES.md Round 1). Nothing about
// React component lifecycle prevents a second ConnectScreen instance (e.g.
// after navigating away and back) from calling in while a prior call is
// genuinely stuck rather than merely slow, so this guard lives here rather
// than in a component's local state -- it's enforced regardless of which
// caller or component instance is asking.
let asyncCallInFlight = false;

async function runAsyncCcall<T>(fn: () => Promise<T>): Promise<T> {
  if (asyncCallInFlight) {
    throw new Error('A WASM async operation is already in flight -- cannot start another.');
  }
  asyncCallInFlight = true;
  try {
    return await fn();
  } finally {
    asyncCallInFlight = false;
  }
}

function onNotification(event: Event): void {
  const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
  const value = characteristic.value;
  if (!value) return;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const waiter = notificationWaiters.shift();
  if (waiter) {
    waiter(bytes);
  } else {
    notificationQueue.push(bytes);
  }
}

function waitForNotification(timeoutMs: number): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const queued = notificationQueue.shift();
    if (queued) {
      resolve(queued);
      return;
    }
    const settle = (bytes: Uint8Array | null) => {
      clearTimeout(timer);
      resolve(bytes);
    };
    const timer = setTimeout(() => {
      const idx = notificationWaiters.indexOf(settle);
      if (idx !== -1) notificationWaiters.splice(idx, 1);
      resolve(null);
    }, timeoutMs);
    notificationWaiters.push(settle);
  });
}

/** Resolves once the WASM module has finished loading. Race-free by
 * construction — see index.html's inline bootstrap script for why. */
export function waitForEngineReady(): Promise<void> {
  return window.__webbleReadyPromise;
}

/**
 * Subscribes to `tx`'s notifications and wires Module.webble.read/write to
 * drive I/O over `rx`/`tx` (the pair vendorProfiles.ts resolved for
 * whichever device was picked — the same characteristic for both, for
 * vendors with a combined Rx/Tx characteristic). Resets any leftover
 * notification queue/listener from a prior session first.
 *
 * Call this before setDiveCallbacks() every session -- it resets
 * Module.webble.onDive/onDiveError to no-ops, so calling setDiveCallbacks()
 * first would have its registration silently overwritten, and dives would
 * be dropped with no visible error.
 */
export async function installTransport(
  rx: BluetoothRemoteGATTCharacteristic,
  tx: BluetoothRemoteGATTCharacteristic
): Promise<void> {
  if (txCharacteristic && notificationListener) {
    txCharacteristic.removeEventListener('characteristicvaluechanged', notificationListener);
  }

  rxCharacteristic = rx;
  txCharacteristic = tx;
  notificationQueue = [];
  notificationWaiters = [];

  await tx.startNotifications();
  notificationListener = onNotification;
  tx.addEventListener('characteristicvaluechanged', notificationListener);

  window.Module.webble = {
    async read() {
      return await waitForNotification(5000);
    },
    async write(bytes: Uint8Array) {
      if (!rxCharacteristic) return false;
      // 20ms write-pacing delay: Web Bluetooth's writeValueWithoutResponse()
      // Promise resolving doesn't guarantee the radio has caught up (see
      // webble/NOTES.md Round 3) -- cheap defensive insurance against
      // overwhelming the BLE stack on rapid successive writes.
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        // Bounded like read()'s waitForNotification(5000) -- unlike read(),
        // a hung writeValueWithoutResponse() has no built-in timeout of its
        // own, and a real hardware test (app/NOTES.md Round 1) hit an
        // indefinite hang here with no further log output, well past any
        // read timeout, consistent with a stuck write never settling.
        const timedOut = Symbol('write-timeout');
        const result = await Promise.race([
          rxCharacteristic.writeValueWithoutResponse(bytes as BufferSource),
          new Promise<typeof timedOut>((resolve) => setTimeout(() => resolve(timedOut), 5000)),
        ]);
        return result !== timedOut;
      } catch {
        return false;
      }
    },
    onDive: () => {},
    onDiveError: () => {},
  };
}

export async function openTransport(): Promise<number> {
  return runAsyncCcall(() => window.Module.ccall('webble_open', 'number', [], [], { async: true }));
}

export async function closeSession(): Promise<void> {
  await runAsyncCcall(() => window.Module.ccall('webble_close', null, [], [], { async: true }));
}

export async function openDevice(deviceName: string): Promise<number> {
  return runAsyncCcall(() =>
    window.Module.ccall('webble_open_device', 'number', ['string'], [deviceName], { async: true })
  );
}

export function getDeviceVendor(): string {
  return window.Module.ccall('webble_get_device_vendor', 'string', [], []);
}

export function getDeviceProduct(): string {
  return window.Module.ccall('webble_get_device_product', 'string', [], []);
}

export function getDeviceSerialHex(): string {
  return window.Module.ccall('webble_get_device_serial_hex', 'string', [], []);
}

export async function downloadNewDives(fingerprintHex: string): Promise<number> {
  return runAsyncCcall(() =>
    window.Module.ccall('webble_download_new_dives', 'number', ['string'], [fingerprintHex], { async: true })
  );
}

export function getLatestFingerprintHex(): string {
  return window.Module.ccall('webble_get_latest_fingerprint_hex', 'string', [], []);
}

export type DiveCallback = (dive: CanonicalDive) => void | Promise<void>;
export type DiveErrorCallback = (index: number, message: string) => void;

/** Registers the callbacks the WASM engine invokes per dive during downloadNewDives(). */
export function setDiveCallbacks(onDive: DiveCallback, onDiveError: DiveErrorCallback): void {
  window.Module.webble.onDive = (json: string) => {
    void onDive(JSON.parse(json) as CanonicalDive);
  };
  window.Module.webble.onDiveError = onDiveError;
}
