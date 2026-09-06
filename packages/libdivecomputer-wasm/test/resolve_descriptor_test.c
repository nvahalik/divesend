// Enumeration test for webble_resolve_ble_descriptor (descriptor_match.c).
//
// libdivecomputer's descriptor table IS the list of models it supports, so
// this walks that table instead of hard-coding one. Two checks:
//
//  1. Round-trip: for every BLE descriptor whose *product name* is something
//     its own family filter would accept as an advertised name, resolving
//     that name must return the same vendor+product -- never a wrong-framing
//     sibling (the "Quad Ci" opened as "Mares Smart" bug). Families whose
//     advertised name differs from the product string (Mares, and the
//     suffixed Shearwater/Ratio models) can't be covered this way -- there's
//     no ground truth for what they broadcast -- so they're counted as
//     skipped and, for the ones that matter, pinned explicitly below.
//
//  2. Pinned names: KNOWN[] must resolve exactly; KNOWN_FALLBACK[] is the
//     set we currently *can't* resolve and knowingly fall back on -- pinned
//     so that if the matcher ever gets good enough to resolve one, this test
//     fails and tells us to promote it to KNOWN[].
//
// Run via ./test.sh (emcc -> node). Exit non-zero on any hard failure.
// Set WEBBLE_TEST_VERBOSE=1 to list every skipped descriptor.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <libdivecomputer/context.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/iterator.h>

#include "../src/webble_internal.h"

// Advertised name -> the model it MUST resolve to. Names taken from
// libdivecomputer's own dc_filter_* bluetooth lists (descriptor.c), which are
// the closest thing to ground truth for what each model broadcasts.
static const struct { const char *advertised, *vendor, *product; } KNOWN[] = {
	// Mares -- the family with model-specific BLE framing (FIXED vs VARIABLE),
	// decided from the descriptor before libdivecomputer's own autodetect can
	// correct it, so resolving to the wrong sibling breaks the download.
	{ "Quad Ci",        "Mares", "Quad Ci" },
	{ "Quad2",          "Mares", "Quad 2" },        // dropped space
	{ "Sirius",         "Mares", "Sirius" },
	{ "Sirius L",       "Mares", "Sirius L" },
	{ "Puck4",          "Mares", "Puck 4" },        // dropped space
	{ "Puck Lite",      "Mares", "Puck Lite" },
	{ "Puck Pro Ultra", "Mares", "Puck Pro Ultra" },
	{ "Mares Genius",   "Mares", "Genius" },        // leading vendor word
};

// Names we knowingly resolve only by falling back to the first same-family
// descriptor (a guess). Pinned so a future matcher improvement that fixes one
// trips this test instead of going unnoticed.
static const char *KNOWN_FALLBACK[] = {
	"Puck Pro U", // contraction of "Puck Pro Ultra" with no clean expansion
};

static int
check_known (dc_context_t *ctx)
{
	int failures = 0;
	for (unsigned int i = 0; i < sizeof (KNOWN) / sizeof (KNOWN[0]); i++) {
		int fb = -1;
		dc_descriptor_t *r = webble_resolve_ble_descriptor (ctx, KNOWN[i].advertised, &fb);
		const char *v = r ? dc_descriptor_get_vendor (r) : "(none)";
		const char *p = r ? dc_descriptor_get_product (r) : "(none)";
		if (!r || fb != 0 || strcmp (v, KNOWN[i].vendor) != 0 || strcmp (p, KNOWN[i].product) != 0) {
			printf ("FAIL known: \"%s\" -> %s %s (fallback=%d), want %s %s (fallback=0)\n",
				KNOWN[i].advertised, v, p, fb, KNOWN[i].vendor, KNOWN[i].product);
			failures++;
		}
		dc_descriptor_free (r);
	}
	return failures;
}

static int
check_known_fallback (dc_context_t *ctx)
{
	int failures = 0;
	for (unsigned int i = 0; i < sizeof (KNOWN_FALLBACK) / sizeof (KNOWN_FALLBACK[0]); i++) {
		int fb = -1;
		dc_descriptor_t *r = webble_resolve_ble_descriptor (ctx, KNOWN_FALLBACK[i], &fb);
		if (!r || fb != 1) {
			printf ("FAIL known-fallback: \"%s\" -> fallback=%d (expected a fallback guess); "
				"if the matcher now resolves it, move it to KNOWN[]\n", KNOWN_FALLBACK[i], fb);
			failures++;
		}
		dc_descriptor_free (r);
	}
	return failures;
}

// Every BLE descriptor whose product name its family filter accepts must
// resolve straight back to itself.
static int
check_roundtrip (dc_context_t *ctx, int *out_scanned, int *out_skipped)
{
	int failures = 0, scanned = 0, skipped = 0;
	int verbose = getenv ("WEBBLE_TEST_VERBOSE") != NULL;

	dc_iterator_t *it = NULL;
	if (dc_descriptor_iterator_new (&it, ctx) != DC_STATUS_SUCCESS) {
		printf ("FAIL: dc_descriptor_iterator_new\n");
		return 1;
	}

	dc_descriptor_t *d = NULL;
	while (dc_iterator_next (it, &d) == DC_STATUS_SUCCESS) {
		if ((dc_descriptor_get_transports (d) & DC_TRANSPORT_BLE) == 0) {
			dc_descriptor_free (d);
			continue;
		}
		const char *vendor = dc_descriptor_get_vendor (d);
		const char *product = dc_descriptor_get_product (d);

		if (!dc_descriptor_filter (d, DC_TRANSPORT_BLE, product)) {
			if (verbose) printf ("skip (advertised name != product): %s %s\n", vendor, product);
			skipped++;
			dc_descriptor_free (d);
			continue;
		}

		scanned++;
		int fb = -1;
		dc_descriptor_t *r = webble_resolve_ble_descriptor (ctx, product, &fb);
		const char *rv = r ? dc_descriptor_get_vendor (r) : "(none)";
		const char *rp = r ? dc_descriptor_get_product (r) : "(none)";
		if (!r || fb != 0 || strcmp (rv, vendor) != 0 || strcmp (rp, product) != 0) {
			printf ("FAIL roundtrip: %s %s -> %s %s (fallback=%d)\n", vendor, product, rv, rp, fb);
			failures++;
		}
		dc_descriptor_free (r);
		dc_descriptor_free (d);
	}
	dc_iterator_free (it);

	*out_scanned = scanned;
	*out_skipped = skipped;
	return failures;
}

// The is_fallback out-param must actually distinguish a guess from a match.
static int
check_fallback_flag (dc_context_t *ctx)
{
	int failures = 0;

	int fb = -1;
	dc_descriptor_t *exact = webble_resolve_ble_descriptor (ctx, "Quad Ci", &fb);
	if (!exact || fb != 0) {
		printf ("FAIL fallback-flag: \"Quad Ci\" should be an exact match (fallback=%d)\n", fb);
		failures++;
	}
	dc_descriptor_free (exact);

	fb = -1;
	dc_descriptor_t *guess = webble_resolve_ble_descriptor (ctx, "Puck Pro Nonsense", &fb);
	if (!guess || fb != 1) {
		printf ("FAIL fallback-flag: \"Puck Pro Nonsense\" should be a fallback guess (fallback=%d)\n", fb);
		failures++;
	}
	dc_descriptor_free (guess);

	return failures;
}

int
main (void)
{
	dc_context_t *ctx = NULL;
	if (dc_context_new (&ctx) != DC_STATUS_SUCCESS) {
		printf ("FAIL: dc_context_new\n");
		return 1;
	}

	int scanned = 0, skipped = 0;
	int failures = 0;
	failures += check_roundtrip (ctx, &scanned, &skipped);
	failures += check_known (ctx);
	failures += check_known_fallback (ctx);
	failures += check_fallback_flag (ctx);

	dc_context_free (ctx);

	printf ("\nround-trip: %d BLE descriptors ok, %d skipped (advertised name != product); "
		"pinned: %zu exact + %zu fallback; %d failure(s)\n",
		scanned, skipped,
		sizeof (KNOWN) / sizeof (KNOWN[0]),
		sizeof (KNOWN_FALLBACK) / sizeof (KNOWN_FALLBACK[0]),
		failures);
	if (skipped && !getenv ("WEBBLE_TEST_VERBOSE")) {
		printf ("(set WEBBLE_TEST_VERBOSE=1 to list the skipped descriptors)\n");
	}
	return failures ? 1 : 0;
}
