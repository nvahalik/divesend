# Dive computer BLE GATT UUID reference

Service and characteristic UUIDs for the serial-over-BLE transports used by common dive computer vendors. Collected for the WebBLE PoC (`docs/superpowers/specs/2026-08-22-webble-poc-design.md`); useful for any future multi-vendor Web Bluetooth support since this PoC currently targets Shearwater only.

Each of these wraps a proprietary serial protocol (the dive computer's real "language") inside a vendor-specific BLE transport (Rx/Tx characteristics standing in for a UART). `libdivecomputer` already knows how to speak the serial protocol for every vendor below over other transports (USB/Bluetooth Classic) — what varies here is only the BLE plumbing needed to reach it.

The service UUIDs below are also collected in `main.js`'s `KNOWN_DIVE_COMPUTER_SERVICES` array, used to filter the `requestDevice()` picker.

## Shearwater — target for this PoC

Reference: proprietary (no public spec)

- Service: `fe25c237-0ece-443c-b0aa-e02033e7029d`
- Characteristics:
  - Rx/Tx: `27b7570b-359e-45a3-91bb-cf7e70049bd2` (read, write-without-response, notify)

**Perdix 2/Perdix AI variant** (older firmware) uses different UUIDs — see note below if the primary UUIDs above aren't found.

**Perdix 3** uses a distinct variant:
- Service: `1aa44039-1667-4b29-87cc-dfecaaf31d97`
- Characteristics:
  - Rx: `e8460acd-e525-477d-bc50-c743e08d23f4` (write-without-response)
  - Tx: `cd5683d6-eb69-4012-9e5b-9083e419cef2` (notify)

## Telit/Stollmann (Heinrichs Weikamp)

Reference: [Telit TIO Implementation Guide r06](https://www.telit.com/wp-content/uploads/2017/10/Telit_TIO_Implementation_Guide_r06.pdf)

- Service: `0000fefb-0000-1000-8000-00805f9b34fb`
- Characteristics:
  - Rx: `00000001-0000-1000-8000-008025000000` (write-without-response)
  - Tx: `00000002-0000-1000-8000-008025000000` (notify)
  - Rx Credits: `00000003-0000-1000-8000-008025000000` (write)
  - Tx Credits: `00000004-0000-1000-8000-008025000000` (indicate)

## U-Blox (Heinrichs Weikamp)

Reference: [u-connectXpress Low Energy Serial Port Service spec](https://www.u-blox.com/sites/default/files/u-connectXpress-LowEnergySerialPortService_ProtocolSpec_UBX-16011192.pdf)

- Service: `2456e1b9-26e2-8f83-e744-f34f01e9d701`
- Characteristics:
  - Rx/Tx: `2456e1b9-26e2-8f83-e744-f34f01e9d703` (read, write, write-without-response, notify)
  - Rx/Tx Credits: `2456e1b9-26e2-8f83-e744-f34f01e9d704` (write, write-without-response, notify)

## Nordic Semiconductor (Deepblu, Oceans, Divesoft)

Reference: [Nordic UART Service (NUS)](https://developer.nordicsemi.com/nRF_Connect_SDK/doc/latest/nrf/libraries/bluetooth_services/services/nus.html)

- Service: `6e400001-b5a3-f393-e0a9-e50e24dcca9e`
- Characteristics:
  - Rx: `6e400002-b5a3-f393-e0a9-e50e24dcca9e` (write, write-without-response)
  - Tx: `6e400003-b5a3-f393-e0a9-e50e24dcca9e` (notify)

## Microchip (Ratio, McLean)

Reference: [Microchip BLE Transparent UART Service](https://microchipdeveloper.com/wireless:ble-mchp-transparent-uart-service)

- Service: `49535343-fe7d-4ae5-8fa9-9fafd205e455`
- Characteristics:
  - Rx: `49535343-8841-43f4-a8d4-ecbe34729bb3` (write, write-without-response)
  - Tx: `49535343-1e4d-4bd9-ba61-23c647249616` (write, write-without-response, notify, indicate)

## Mares

- Service: `544e326b-5b72-c6b0-1c46-41c1bc448118`
- Characteristics:
  - Rx: `99a91ebd-b21f-1689-bb43-681f1f55e966` (read, write-without-response)
  - Tx: `1d1aae28-d2a8-91a1-1242-9d2973fbe571` (read, notify)

## Suunto

- Service: `98ae7120-e62e-11e3-badd-0002a5d5c51b`
- Characteristics:
  - Rx: `c6339440-e62e-11e3-a5b3-0002a5d5c51b` (write-without-response)
  - Tx: `d0fd6b80-e62e-11e3-a2e9-0002a5d5c51b` (notify)

## ScubaPro

- Service: `fdcdeaaa-295d-470e-bf15-04217b7aa0a0`
- Characteristics:
  - Rx: `a188b7dd-debb-449a-852d-c243d46b4b1a` (write)
  - Tx: `aa0c68f0-ea9c-493d-8112-62879e72af68` (read, notify)

## Pelagic

- Service: `cb3c4555-d670-4670-bc20-b61dbc851e9a`
- Characteristics:
  - Rx: `6606ab42-89d5-4a00-a8ce-4eb5e1414ee0` (read, write, write-without-response)
  - Tx: `a60b8e5c-b267-44d7-9764-837caf96489e` (read, write, notify)

Some models (e.g. Aqualung i330R and Apeks DSX) use a different variant:
- Service: `ca7b0001-f785-4c38-b599-c7c5fbadb034`
- Characteristics:
  - Rx: `ca7b0003-f785-4c38-b599-c7c5fbadb034` (write, write-without-response)
  - Tx: `ca7b0002-f785-4c38-b599-c7c5fbadb034` (read, notify)

## Deep Six

- Service: `f000ffe0-ab12-45ec-84c8-46483f4626e9`
- Characteristics:
  - Rx/Tx: `f000ffe1-ab12-45ec-84c8-46483f4626e9` (read, write, write-without-response, notify)

## Divesoft

- Service: `0000fcef-0000-1000-8000-00805f9b34fb`
- Characteristics:
  - Rx: `6e400002-b5a3-f393-e0a9-e50e24dcca9e` (write, write-without-response)
  - Tx: `6e400003-b5a3-f393-e0a9-e50e24dcca9e` (notify)

Some devices use a (transitional) variant with 16-bit-style characteristics:
- Service: `0000fcef-0000-1000-8000-00805f9b34fb`
- Characteristics:
  - Rx: `00000002-0000-1000-8000-00805f9b34fb` (write, write-without-response)
  - Tx: `00000003-0000-1000-8000-00805f9b34fb` (notify)

## Cressi

- Service: `6e400001-b5a3-f393-e0a9-e50e24dc10b8`
- Characteristics:
  - Rx: `6e400001-b5a3-f393-e0a9-e50e24dc10b8` (write, write-without-response)
  - Tx: `6e400002-b5a3-f393-e0a9-e50e24dc10b8` (notify)
  - Serial/Model: `6e400003-b5a3-f393-e0a9-e50e24dc10b8` (read, 5 bytes)
  - Firmware: `6e400004-b5a3-f393-e0a9-e50e24dc10b8` (read, 2 bytes)
  - Unknown: `6e400005-b5a3-f393-e0a9-e50e24dc10b8` (read, 2 bytes)

**Note:** Cressi devices also advertise a standard Nordic UART service (see above) — this must be ignored in favor of the Cressi-specific service, since UUIDs otherwise look identical to Nordic's NUS pattern.

## Halcyon Symbios

- Service: `00000001-8c3b-4f2c-a59e-8c08224f3253`
- Characteristics:
  - Rx: `00000101-8c3b-4f2c-a59e-8c08224f3253` (read, write, indicate)
  - Tx: `00000201-8c3b-4f2c-a59e-8c08224f3253` (read, write, indicate)

## Seac

- Service: `84968ffe-d26d-478a-b953-5010bcf58bca`
- Characteristics:
  - Rx/Tx: `43c620c2-1b09-4951-bc1e-9c75298cddeb` (read, write)
