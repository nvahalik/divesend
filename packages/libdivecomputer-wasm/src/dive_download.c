#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <emscripten.h>

#include <libdivecomputer/device.h>

#include "webble_internal.h"

// JS-side hook: receives one dive's JSON as soon as it's decoded. Synchronous
// -- no BLE I/O happens in this call, so it doesn't need Asyncify -- and
// doubles as progress reporting, since JS gets called once per dive as the
// manifest walk proceeds.
EM_JS(void, webble_js_on_dive, (const char *json), {
	Module.webble.onDive(UTF8ToString(json));
});

EM_JS(void, webble_js_on_dive_error, (int index, const char *message), {
	Module.webble.onDiveError(index, UTF8ToString(message));
});

static char *g_latest_fingerprint_hex = NULL;
static int g_dive_index = 0;

static int
hex_decode (const char *hex, unsigned char **out_bytes, unsigned int *out_size)
{
	size_t len = strlen (hex);
	if (len == 0) {
		*out_bytes = NULL;
		*out_size = 0;
		return 0;
	}
	if (len % 2 != 0) {
		return -1;
	}
	unsigned int size = (unsigned int) (len / 2);
	unsigned char *bytes = (unsigned char *) malloc (size);
	if (!bytes) {
		return -1;
	}
	for (unsigned int i = 0; i < size; i++) {
		unsigned int byte = 0;
		if (sscanf (hex + i * 2, "%2x", &byte) != 1) {
			free (bytes);
			return -1;
		}
		bytes[i] = (unsigned char) byte;
	}
	*out_bytes = bytes;
	*out_size = size;
	return 0;
}

static char *
hex_encode (const unsigned char *bytes, unsigned int size)
{
	char *hex = (char *) malloc (size * 2 + 1);
	if (!hex) {
		return NULL;
	}
	for (unsigned int i = 0; i < size; i++) {
		snprintf (hex + i * 2, 3, "%02x", bytes[i]);
	}
	hex[size * 2] = '\0';
	return hex;
}

// dc_dive_callback_t: returning 0 stops dc_device_foreach's walk, non-zero
// continues -- confirmed against shearwater_petrel_device_foreach's actual
// `if (callback && !callback(...)) break;`. Get this backwards and every
// download silently becomes "just the first dive" again.
static int
dive_callback (const unsigned char *data, unsigned int size, const unsigned char *fingerprint, unsigned int fsize, void *userdata)
{
	(void) userdata;

	// The manifest walk visits dives newest-first and stops once it reaches
	// the fingerprint set via dc_device_set_fingerprint -- so the first dive
	// seen in a walk is always the newest, and its fingerprint is what to
	// persist for the next incremental sync.
	if (g_dive_index == 0 && fingerprint && fsize > 0) {
		free (g_latest_fingerprint_hex);
		g_latest_fingerprint_hex = hex_encode (fingerprint, fsize);
	}

	char *json = NULL;
	dc_status_t status = webble_decode_dive_to_json (data, size, webble_current_device (), &json);
	if (status != DC_STATUS_SUCCESS || !json) {
		char message[64];
		snprintf (message, sizeof (message), "decode failed (status %d)", (int) status);
		webble_js_on_dive_error (g_dive_index, message);
		return 0; // stop the walk; dives already streamed remain valid
	}

	webble_js_on_dive (json);
	free (json);

	g_dive_index++;
	return 1; // continue to the next dive
}

// Returns the number of new dives downloaded (>= 0) or a negative status
// code: -1 no device open, -2 malformed fingerprint_hex, -3 the manifest
// walk itself failed (e.g. BLE I/O error mid-download).
EMSCRIPTEN_KEEPALIVE
int
webble_download_new_dives (const char *fingerprint_hex)
{
	dc_device_t *device = webble_current_device ();
	if (!device) {
		return -1;
	}

	unsigned char *fingerprint_bytes = NULL;
	unsigned int fingerprint_size = 0;
	if (hex_decode (fingerprint_hex, &fingerprint_bytes, &fingerprint_size) != 0) {
		return -2;
	}
	if (fingerprint_size > 0) {
		dc_device_set_fingerprint (device, fingerprint_bytes, fingerprint_size);
	}
	free (fingerprint_bytes);

	g_dive_index = 0;
	free (g_latest_fingerprint_hex);
	g_latest_fingerprint_hex = NULL;

	dc_status_t status = dc_device_foreach (device, dive_callback, NULL);
	if (status != DC_STATUS_SUCCESS) {
		return -3;
	}

	return g_dive_index;
}

EMSCRIPTEN_KEEPALIVE
const char *
webble_get_latest_fingerprint_hex (void)
{
	return g_latest_fingerprint_hex ? g_latest_fingerprint_hex : "";
}
