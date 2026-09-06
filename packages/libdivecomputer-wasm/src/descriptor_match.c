// Pure BLE-name -> dc_descriptor_t resolution, split out of device_session.c
// so it carries no global state and no Emscripten dependency: device_session.c
// links it into the wasm module, and test/resolve_descriptor_test.c links it
// into a native (emcc-run-under-node) enumeration test.

#include <ctype.h>
#include <string.h>
#include <strings.h>

#include <libdivecomputer/context.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/iterator.h>

#include "webble_internal.h"

// Compares a BLE advertised name against a libdivecomputer product string,
// tolerating the two ways Mares advertised names diverge from the product
// table: a dropped space ("Quad2" vs "Quad 2", "Puck4" vs "Puck 4") and a
// leading vendor word ("Mares Genius" vs "Genius"). Spaces on either side are
// ignored and a leading "Mares " on the advertised name is skipped; the rest
// must match case-insensitively with both strings fully consumed. This is NOT
// a fuzzy/substring match -- "Smart" never matches "Smart Air" -- it just
// absorbs those two known formatting differences. Contracted names with no
// clean expansion (e.g. advertised "Puck Pro U" for product "Puck Pro Ultra")
// still won't match here and fall through to the caller's fallback.
static int
webble_ble_name_matches_product (const char *advertised, const char *product)
{
	if (strncasecmp (advertised, "mares ", 6) == 0) {
		advertised += 6;
	}
	while (*advertised && *product) {
		if (*advertised == ' ') { advertised++; continue; }
		if (*product == ' ') { product++; continue; }
		if (tolower ((unsigned char) *advertised) != tolower ((unsigned char) *product)) {
			return 0;
		}
		advertised++;
		product++;
	}
	while (*advertised == ' ') advertised++;
	while (*product == ' ') product++;
	return *advertised == '\0' && *product == '\0';
}

// Resolves a BLE device's advertised name to the dc_descriptor_t to open it
// with. Returns a descriptor the caller owns (dc_descriptor_free it) or NULL
// if nothing in libdivecomputer's table could serve this name at all.
//
// dc_descriptor_filter is deliberately coarse for BLE: for several vendors
// (Mares especially) it's a family-wide prefix match that returns true for
// *every* descriptor in that family, not just the one product. Taking the
// first filter hit therefore opens e.g. a "Quad Ci" as a "Mares Smart" --
// libdivecomputer's version-packet autodetect then fixes device->model, but
// NOT the FIXED-vs-VARIABLE BLE framing choice (mares_iconhd_device_open
// derives that once, from the model handed to dc_device_open, and never
// revisits it), so the manifest walk talks the wrong framing and fails. So:
// prefer the descriptor whose product name matches the advertised name (via
// webble_ble_name_matches_product, which absorbs Mares's space/vendor-prefix
// quirks). Only when nothing matches do we fall back to the first filter hit
// -- which for Mares is always "Mares Smart", so an unrecognised Mares BLE
// name that needs VARIABLE framing (Sirius-era hardware) will still fail its
// download. Adding the model to libdivecomputer's descriptor table + this
// matcher is the fix when that happens.
//
// When out_is_fallback is non-NULL it's set to 1 if the returned descriptor is
// that first-filter-hit guess (so the caller can warn), 0 if it's a real
// name match, and left untouched when NULL is returned.
dc_descriptor_t *
webble_resolve_ble_descriptor (dc_context_t *context, const char *device_name, int *out_is_fallback)
{
	dc_iterator_t *iterator = NULL;
	if (dc_descriptor_iterator_new (&iterator, context) != DC_STATUS_SUCCESS) {
		return NULL;
	}

	dc_descriptor_t *descriptor = NULL;
	dc_descriptor_t *match = NULL;     // product-name match for device_name
	dc_descriptor_t *fallback = NULL;  // first filter hit, used only if nothing matches
	while (dc_iterator_next (iterator, &descriptor) == DC_STATUS_SUCCESS) {
		if (dc_descriptor_filter (descriptor, DC_TRANSPORT_BLE, device_name)) {
			const char *product = dc_descriptor_get_product (descriptor);
			if (product && webble_ble_name_matches_product (device_name, product)) {
				match = descriptor;
				break;
			}
			if (!fallback) {
				fallback = descriptor;
				continue;
			}
		}
		dc_descriptor_free (descriptor);
	}
	dc_iterator_free (iterator);

	if (match) {
		dc_descriptor_free (fallback);
		if (out_is_fallback) *out_is_fallback = 0;
		return match;
	}
	if (fallback && out_is_fallback) *out_is_fallback = 1;
	return fallback;
}
