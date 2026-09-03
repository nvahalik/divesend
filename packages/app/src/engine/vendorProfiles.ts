// app/src/engine/vendorProfiles.ts
// Ported from ../../../webble/BLE_UUIDS.md (repo-root-relative: webble/BLE_UUIDS.md)
// — the source of truth for these UUIDs; re-verify or add vendors there first.
// Only entries with concrete UUIDs for
// every one of service/rx/tx are included here — e.g. the older
// Perdix2/pre-Teric Shearwater firmware variant and Divesoft's
// transitional 16-bit-characteristic variant are documented in
// BLE_UUIDS.md as notes without full UUID sets, so they're not
// representable in this table and are omitted, not silently guessed at.
//
// rx === tx for vendors that share a single combined Rx/Tx characteristic
// (Shearwater, U-Blox, Deep Six, Seac) — ConnectScreen fetches both
// unconditionally rather than special-casing this, since getCharacteristic()
// with equal UUIDs is cheap and correct either way.
export interface VendorBleProfile {
  vendor: string;
  service: string;
  rx: string;
  tx: string;
}

export const VENDOR_BLE_PROFILES: VendorBleProfile[] = [
  {
    vendor: 'Shearwater',
    service: 'fe25c237-0ece-443c-b0aa-e02033e7029d',
    rx: '27b7570b-359e-45a3-91bb-cf7e70049bd2',
    tx: '27b7570b-359e-45a3-91bb-cf7e70049bd2',
  },
  {
    vendor: 'Shearwater Perdix 3',
    service: '1aa44039-1667-4b29-87cc-dfecaaf31d97',
    rx: 'e8460acd-e525-477d-bc50-c743e08d23f4',
    tx: 'cd5683d6-eb69-4012-9e5b-9083e419cef2',
  },
  {
    vendor: 'Telit/Stollmann (Heinrichs Weikamp)',
    service: '0000fefb-0000-1000-8000-00805f9b34fb',
    rx: '00000001-0000-1000-8000-008025000000',
    tx: '00000002-0000-1000-8000-008025000000',
  },
  {
    vendor: 'U-Blox (Heinrichs Weikamp)',
    service: '2456e1b9-26e2-8f83-e744-f34f01e9d701',
    rx: '2456e1b9-26e2-8f83-e744-f34f01e9d703',
    tx: '2456e1b9-26e2-8f83-e744-f34f01e9d703',
  },
  {
    vendor: 'Nordic UART (Deepblu, Oceans, Divesoft)',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  },
  {
    vendor: 'Microchip (Ratio, McLean)',
    service: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    rx: '49535343-8841-43f4-a8d4-ecbe34729bb3',
    tx: '49535343-1e4d-4bd9-ba61-23c647249616',
  },
  {
    vendor: 'Mares',
    service: '544e326b-5b72-c6b0-1c46-41c1bc448118',
    rx: '99a91ebd-b21f-1689-bb43-681f1f55e966',
    tx: '1d1aae28-d2a8-91a1-1242-9d2973fbe571',
  },
  {
    vendor: 'Suunto',
    service: '98ae7120-e62e-11e3-badd-0002a5d5c51b',
    rx: 'c6339440-e62e-11e3-a5b3-0002a5d5c51b',
    tx: 'd0fd6b80-e62e-11e3-a2e9-0002a5d5c51b',
  },
  {
    vendor: 'ScubaPro',
    service: 'fdcdeaaa-295d-470e-bf15-04217b7aa0a0',
    rx: 'a188b7dd-debb-449a-852d-c243d46b4b1a',
    tx: 'aa0c68f0-ea9c-493d-8112-62879e72af68',
  },
  {
    vendor: 'Pelagic',
    service: 'cb3c4555-d670-4670-bc20-b61dbc851e9a',
    rx: '6606ab42-89d5-4a00-a8ce-4eb5e1414ee0',
    tx: 'a60b8e5c-b267-44d7-9764-837caf96489e',
  },
  {
    vendor: 'Pelagic (Aqualung i330R, Apeks DSX)',
    service: 'ca7b0001-f785-4c38-b599-c7c5fbadb034',
    rx: 'ca7b0003-f785-4c38-b599-c7c5fbadb034',
    tx: 'ca7b0002-f785-4c38-b599-c7c5fbadb034',
  },
  {
    vendor: 'Deep Six',
    service: 'f000ffe0-ab12-45ec-84c8-46483f4626e9',
    rx: 'f000ffe1-ab12-45ec-84c8-46483f4626e9',
    tx: 'f000ffe1-ab12-45ec-84c8-46483f4626e9',
  },
  {
    vendor: 'Divesoft',
    service: '0000fcef-0000-1000-8000-00805f9b34fb',
    rx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    tx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  },
  {
    vendor: 'Cressi',
    service: '6e400001-b5a3-f393-e0a9-e50e24dc10b8',
    rx: '6e400001-b5a3-f393-e0a9-e50e24dc10b8',
    tx: '6e400002-b5a3-f393-e0a9-e50e24dc10b8',
  },
  {
    vendor: 'Halcyon Symbios',
    service: '00000001-8c3b-4f2c-a59e-8c08224f3253',
    rx: '00000101-8c3b-4f2c-a59e-8c08224f3253',
    tx: '00000201-8c3b-4f2c-a59e-8c08224f3253',
  },
  {
    vendor: 'Seac',
    service: '84968ffe-d26d-478a-b953-5010bcf58bca',
    rx: '43c620c2-1b09-4951-bc1e-9c75298cddeb',
    tx: '43c620c2-1b09-4951-bc1e-9c75298cddeb',
  },
];
