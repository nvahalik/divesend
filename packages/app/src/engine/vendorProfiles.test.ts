import { describe, expect, it } from 'vitest';
import { VENDOR_BLE_PROFILES } from './vendorProfiles';

describe('VENDOR_BLE_PROFILES', () => {
  it('has a unique service UUID per entry', () => {
    // ConnectScreen resolves the connected device's vendor by probing
    // getPrimaryService(profile.service) for each entry in order and
    // taking the first match -- a duplicate service UUID would make that
    // resolution silently pick whichever entry happens to be listed
    // first, misattributing the device to the wrong vendor.
    const services = VENDOR_BLE_PROFILES.map((p) => p.service);
    expect(new Set(services).size).toBe(services.length);
  });

  it('has non-empty vendor/service/rx/tx values for every entry', () => {
    for (const profile of VENDOR_BLE_PROFILES) {
      expect(profile.vendor).not.toBe('');
      expect(profile.service).not.toBe('');
      expect(profile.rx).not.toBe('');
      expect(profile.tx).not.toBe('');
    }
  });
});
