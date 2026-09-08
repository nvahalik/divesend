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
static int g_match_is_fallback = 0;
static char g_serial_hex[16];
static webble_progress_fn g_progress_fn = NULL;
static void *g_progress_userdata = NULL;

// The ONE event callback registered on the device for the whole session (see
// webble_open_device). It multiplexes every event libdivecomputer raises during
// dc_device_foreach: DC_EVENT_DEVINFO is captured here for the serial number,
// DC_EVENT_PROGRESS is forwarded to whatever hook the current caller installed
// via webble_set_progress_hook. Nothing else may call dc_device_set_events --
// doing so would silently drop the DEVINFO subscription and, with it, the
// serial (regression fixed 2026-09: a progress-only re-subscription in
// dive_download.c did exactly that, so synced Shearwater dives lost their
// manufacturer on the SSI side).
static void
session_event_callback (dc_device_t *device, dc_event_type_t event, const void *data, void *userdata)
{
	(void) device;
	(void) userdata;

	if (event == DC_EVENT_DEVINFO) {
		const dc_event_devinfo_t *devinfo = (const dc_event_devinfo_t *) data;
		g_serial = devinfo->serial;
		g_have_devinfo = 1;
		return;
	}

	if (event == DC_EVENT_PROGRESS && g_progress_fn) {
		const dc_event_progress_t *progress = (const dc_event_progress_t *) data;
		g_progress_fn (progress->current, progress->maximum, g_progress_userdata);
	}
}

void
webble_set_progress_hook (webble_progress_fn fn, void *userdata)
{
	g_progress_fn = fn;
	g_progress_userdata = userdata;
}

void
webble_session_dispatch_event (dc_device_t *device, dc_event_type_t event, const void *data, void *userdata)
{
	session_event_callback (device, event, data, userdata);
}

// Resolves this BLE device's advertised name to a dc_descriptor_t (see
// descriptor_match.c for how, and why it isn't just "first filter hit"), then
// opens it generically -- no vendor-specific open call anywhere here,
// dc_device_open's internal vtable dispatch handles that. Status codes: -1
// unused (kept for ABI stability), -2 no descriptor could serve device_name,
// -3 dc_device_open failed.
EMSCRIPTEN_KEEPALIVE
int
webble_open_device (const char *device_name)
{
	if (g_device) {
		webble_close_device ();
	}

	int is_fallback = 0;
	dc_descriptor_t *match = webble_resolve_ble_descriptor (webble_current_context (), device_name, &is_fallback);
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
	g_match_is_fallback = is_fallback;

	// Register the session's single, permanent event callback. It stays put for
	// the life of the open device -- callers that want progress events install a
	// hook via webble_set_progress_hook instead of re-registering here.
	dc_device_set_events (g_device, DC_EVENT_DEVINFO | DC_EVENT_PROGRESS, session_event_callback, NULL);

	return 0;
}

// 1 when webble_open_device resolved the advertised name only by falling back
// to the first same-family descriptor (a guess -- see descriptor_match.c),
// 0 when it was a real product-name match. Meaningful only after a successful
// webble_open_device; reset by webble_close_device.
EMSCRIPTEN_KEEPALIVE
int
webble_device_match_is_fallback (void)
{
	return g_match_is_fallback;
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
	g_match_is_fallback = 0;
	g_progress_fn = NULL;
	g_progress_userdata = NULL;
}

dc_device_t *
webble_current_device (void)
{
	return g_device;
}
