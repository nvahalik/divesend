'use strict';

// Known BLE serial-transport service UUIDs across dive computer vendors.
// Used only to narrow requestDevice()'s picker to plausible dive computers;
// the WASM side still only understands the Shearwater protocol.
const KNOWN_DIVE_COMPUTER_SERVICES = [
  'fe25c237-0ece-443c-b0aa-e02033e7029d', // Shearwater
  '1aa44039-1667-4b29-87cc-dfecaaf31d97', // Shearwater Perdix 3
  '0000fefb-0000-1000-8000-00805f9b34fb', // Telit/Stollmann (Heinrichs Weikamp); also Divesoft
  '2456e1b9-26e2-8f83-e744-f34f01e9d701', // U-Blox (Heinrichs Weikamp)
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART (Deepblu, Oceans, Divesoft)
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // Microchip (Ratio, McLean)
  '544e326b-5b72-c6b0-1c46-41c1bc448118', // Mares
  '98ae7120-e62e-11e3-badd-0002a5d5c51b', // Suunto
  'fdcdeaaa-295d-470e-bf15-04217b7aa0a0', // ScubaPro
  'cb3c4555-d670-4670-bc20-b61dbc851e9a', // Pelagic
  'ca7b0001-f785-4c38-b599-c7c5fbadb034', // Pelagic (Aqualung i330R, Apeks DSX)
  'f000ffe0-ab12-45ec-84c8-46483f4626e9', // Deep Six
  '0000fcef-0000-1000-8000-00805f9b34fb', // Divesoft
  '6e400001-b5a3-f393-e0a9-e50e24dc10b8', // Cressi
  '00000001-8c3b-4f2c-a59e-8c08224f3253', // Halcyon Symbios
  '84968ffe-d26d-478a-b953-5010bcf58bca', // Seac
];

const state = {
  device: null,
  characteristic: null,
};

let dives = [];

let notificationQueue = [];
let notificationWaiters = [];

function log(msg) {
  const pre = document.getElementById('log');
  pre.textContent += msg + '\n';
  pre.scrollTop = pre.scrollHeight;
}

function onNotification(event) {
  const value = event.target.value;
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (notificationWaiters.length > 0) {
    const resolve = notificationWaiters.shift();
    resolve(bytes);
  } else {
    notificationQueue.push(bytes);
  }
}

function waitForNotification(timeoutMs) {
  return new Promise((resolve) => {
    if (notificationQueue.length > 0) {
      resolve(notificationQueue.shift());
      return;
    }
    const timer = setTimeout(() => {
      const idx = notificationWaiters.indexOf(resolve);
      if (idx !== -1) notificationWaiters.splice(idx, 1);
      resolve(null);
    }, timeoutMs);
    notificationWaiters.push((bytes) => {
      clearTimeout(timer);
      resolve(bytes);
    });
  });
}

var Module = {
  webble: {
    async read(maxSize) {
      return await waitForNotification(5000);
    },
    async write(bytes) {
      if (!state.characteristic) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      try {
        await state.characteristic.writeValueWithoutResponse(bytes);
        return true;
      } catch (e) {
        log('write failed: ' + e);
        return false;
      }
    },
    onDive(json) {
      const dive = JSON.parse(json);
      dives.push(dive);
      log('Downloaded dive ' + dives.length + ': ' + dive.header.startTime
        + ' maxDepth=' + dive.header.maxDepthM + 'm samples=' + dive.samples.length);
    },
    onDiveError(index, message) {
      log('Dive ' + index + ' failed to decode: ' + message);
    },
  },
  onRuntimeInitialized() {
    log('wasm module ready');
    document.getElementById('connect').disabled = false;
  },
};

async function pickDevice() {
  if (!navigator.bluetooth) {
    log('Web Bluetooth is not available in this browser.');
    return;
  }

  try {
    const device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true });
    log('Picked device: ' + device.name + ' (id: ' + device.id + ')');
    log('Use chrome://bluetooth-internals/#devices to inspect its services/characteristics, then fill in the UUID fields above.');
  } catch (e) {
    log('Pick device failed or was cancelled: ' + e);
  }
}

async function connect() {
  if (!navigator.bluetooth) {
    log('Web Bluetooth is not available in this browser.');
    return;
  }

  const serviceUuid = document.getElementById('service-uuid').value.trim();
  const characteristicUuid = document.getElementById('characteristic-uuid').value.trim();
  if (!serviceUuid || !characteristicUuid) {
    log('Enter both a service UUID and a characteristic UUID.');
    return;
  }

  dives = [];
  document.getElementById('connect').disabled = true;

  try {
    // Every Connect click starts a fresh session, both C-side and JS-side.
    // Without this, a second click (no page reload) leaves the previous
    // session's state lingering in two places:
    //  - C-side: webble_close() (which cascades to close the device before
    //    the transport, since the device's teardown write needs a live
    //    iostream to go out on) -- without calling this, webble_open()
    //    below would silently allocate a second context/iostream on top of
    //    the first, confusing the underlying device's BLE session state
    //    (confirmed via a real hardware test: a second connect's
    //    dc_device_foreach consistently failed with status -3 once a stale
    //    session was left open this way).
    //  - JS-side: the prior characteristicvaluechanged listener and any
    //    bytes still sitting in notificationQueue, since both are global
    //    state that the *new* session's webble_js_read would otherwise
    //    drain from.
    // All of this must happen here, before requestDevice() reassigns
    // state.device/state.characteristic below, since the C-side teardown
    // write and the listener removal both depend on the *old* characteristic
    // still being the one referenced by state.characteristic.
    await Module.ccall('webble_close', null, [], [], { async: true });
    if (state.characteristic) {
      state.characteristic.removeEventListener('characteristicvaluechanged', onNotification);
    }
    if (state.device && state.device.gatt.connected) {
      state.device.gatt.disconnect();
    }
    notificationQueue = [];
    notificationWaiters = [];

    state.device = await navigator.bluetooth.requestDevice({
      filters: KNOWN_DIVE_COMPUTER_SERVICES.map((uuid) => ({ services: [uuid] })),
    });
    log('Selected device: ' + state.device.name);

    const server = await state.device.gatt.connect();
    const service = await server.getPrimaryService(serviceUuid);
    state.characteristic = await service.getCharacteristic(characteristicUuid);
    await state.characteristic.startNotifications();
    state.characteristic.addEventListener('characteristicvaluechanged', onNotification);
    log('Connected and subscribed to notifications.');

    const openStatus = await Module.ccall('webble_open', 'number', [], [], { async: true });
    if (openStatus !== 0) {
      log('webble_open failed with status ' + openStatus);
      return;
    }
    log('libdivecomputer custom iostream opened.');

    const openDeviceStatus = await Module.ccall(
      'webble_open_device',
      'number',
      ['string'],
      [state.device.name],
      { async: true }
    );
    if (openDeviceStatus !== 0) {
      log('webble_open_device failed with status ' + openDeviceStatus + ' (unrecognized device name?)');
      return;
    }

    const vendor = Module.ccall('webble_get_device_vendor', 'string', [], []);
    const product = Module.ccall('webble_get_device_product', 'string', [], []);
    log('Device session opened: ' + vendor + ' ' + product);

    // Keyed by the BLE device's own persistent id (stable across
    // reconnects/page reloads for a device the user has already paired),
    // NOT the C-side serial number. The serial only becomes known *after*
    // webble_download_new_dives runs -- it's populated as a side effect of
    // the manifest walk itself, not at open time -- so it can't be used to
    // look up a stored fingerprint before that same call. Confirmed via a
    // real hardware test: using the serial for the pre-download lookup
    // always found nothing (the serial hadn't been learned yet for this
    // session), so incremental sync silently never engaged and every
    // connect redownloaded the full dive history.
    const fingerprintKey = 'webble-fingerprint-' + state.device.id;
    const storedFingerprint = localStorage.getItem(fingerprintKey) || '';

    const downloadResult = await Module.ccall(
      'webble_download_new_dives',
      'number',
      ['string'],
      [storedFingerprint],
      { async: true }
    );
    if (downloadResult < 0) {
      log('webble_download_new_dives failed with status ' + downloadResult);
      return;
    }
    log(downloadResult === 0 ? 'Up to date -- no new dives.' : 'Downloaded ' + downloadResult + ' new dive(s).');

    if (downloadResult > 0) {
      const latestFingerprint = Module.ccall('webble_get_latest_fingerprint_hex', 'string', [], []);
      if (latestFingerprint) {
        localStorage.setItem(fingerprintKey, latestFingerprint);
      }
    }
  } catch (e) {
    log('Error: ' + e);
  } finally {
    // Disabled at the top of this function so a rapid double-click can't
    // launch two overlapping connect() calls whose awaits interleave --
    // that would reintroduce the same class of stale-session corruption
    // the teardown above exists to prevent, just via two concurrent runs
    // of this function instead of two sequential clicks.
    document.getElementById('connect').disabled = false;
  }
}

document.getElementById('pick-device').addEventListener('click', pickDevice);
document.getElementById('connect').addEventListener('click', connect);
