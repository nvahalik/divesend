// app/src/lib/webBluetooth.ts
// Whether this browser exposes the Web Bluetooth API at all. DiveSend needs it to
// talk to a dive computer; Firefox, desktop Safari, and iOS Safari don't implement
// it. Kept as a one-line helper so the check has a single home and can be stubbed
// in tests (the default `node` vitest env has no `navigator`).

export function isWebBluetoothSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}
