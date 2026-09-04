// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { isWebBluetoothSupported } from './webBluetooth';

afterEach(() => {
  // Remove anything a test added; jsdom's navigator has no `bluetooth` by default.
  delete (navigator as { bluetooth?: unknown }).bluetooth;
});

describe('isWebBluetoothSupported', () => {
  it('returns false when navigator.bluetooth is absent', () => {
    expect(isWebBluetoothSupported()).toBe(false);
  });

  it('returns true when navigator.bluetooth is present', () => {
    (navigator as { bluetooth?: unknown }).bluetooth = {};
    expect(isWebBluetoothSupported()).toBe(true);
  });
});
