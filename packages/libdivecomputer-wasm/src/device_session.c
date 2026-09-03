#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include <libdivecomputer/context.h>
#include <libdivecomputer/iostream.h>
#include <libdivecomputer/device.h>
#include <libdivecomputer/descriptor.h>

#include "webble_internal.h"

static dc_device_t *g_device = NULL;
static dc_descriptor_t *g_descriptor = NULL;
static unsigned int g_serial = 0;
static int g_have_devinfo = 0;
static char g_serial_hex[16];

static void
devinfo_callback (dc_device_t *device, dc_event_type_t event, const void *data, void *userdata)
{
	(void) device;
	(void) userdata;

	if (event != DC_EVENT_DEVINFO) {
		return;
	}

	const dc_event_devinfo_t *devinfo = (const dc_event_devinfo_t *) data;
	g_serial = devinfo->serial;
	g_have_devinfo = 1;
}

// Finds the dc_descriptor_t matching this BLE device's advertised name (the
// same lookup dctool does), then opens it generically. No vendor-specific
// open call anywhere in this function -- dc_device_open's internal vtable
// dispatch handles that. Status codes: -1 iterator failed, -2 no descriptor
// matched device_name, -3 dc_device_open failed.
EMSCRIPTEN_KEEPALIVE
int
webble_open_device (const char *device_name)
{
	if (g_device) {
		webble_close_device ();
	}

	dc_iterator_t *iterator = NULL;
	if (dc_descriptor_iterator_new (&iterator, webble_current_context ()) != DC_STATUS_SUCCESS) {
		return -1;
	}

	dc_descriptor_t *descriptor = NULL;
	dc_descriptor_t *match = NULL;
	while (dc_iterator_next (iterator, &descriptor) == DC_STATUS_SUCCESS) {
		if (dc_descriptor_filter (descriptor, DC_TRANSPORT_BLE, device_name)) {
			match = descriptor;
			break;
		}
		dc_descriptor_free (descriptor);
	}
	dc_iterator_free (iterator);

	if (!match) {
		return -2;
	}

	g_have_devinfo = 0;
	g_serial = 0;

	if (dc_device_open (&g_device, webble_current_context (), match, webble_current_iostream ()) != DC_STATUS_SUCCESS) {
		dc_descriptor_free (match);
		return -3;
	}

	g_descriptor = match;

	dc_device_set_events (g_device, DC_EVENT_DEVINFO, devinfo_callback, NULL);

	return 0;
}

EMSCRIPTEN_KEEPALIVE
const char *
webble_get_device_vendor (void)
{
	if (!g_descriptor) {
		return "";
	}
	const char *vendor = dc_descriptor_get_vendor (g_descriptor);
	return vendor ? vendor : "";
}

EMSCRIPTEN_KEEPALIVE
const char *
webble_get_device_product (void)
{
	if (!g_descriptor) {
		return "";
	}
	const char *product = dc_descriptor_get_product (g_descriptor);
	return product ? product : "";
}

// Hex-formatted serial number (e.g. "4C579D0F"). Empty string until a
// DC_EVENT_DEVINFO event has fired -- for the Shearwater family this
// happens inside the first webble_download_new_dives() call, not at open
// time, so this is only meaningful *after* a download has run at least
// once. Currently unused for fingerprint-key purposes (main.js keys the
// localStorage fingerprint off the BLE device's own persistent id instead,
// precisely because it's known before this function's value is -- see
// main.js's connect() for why); kept as a getter for display/diagnostic
// purposes (e.g. logging which physical device a session belongs to).
EMSCRIPTEN_KEEPALIVE
const char *
webble_get_device_serial_hex (void)
{
	if (!g_have_devinfo) {
		return "";
	}
	snprintf (g_serial_hex, sizeof (g_serial_hex), "%08X", g_serial);
	return g_serial_hex;
}

EMSCRIPTEN_KEEPALIVE
void
webble_close_device (void)
{
	if (g_device) {
		dc_device_close (g_device);
		g_device = NULL;
	}
	if (g_descriptor) {
		dc_descriptor_free (g_descriptor);
		g_descriptor = NULL;
	}
	g_have_devinfo = 0;
	g_serial = 0;
}

dc_device_t *
webble_current_device (void)
{
	return g_device;
}
