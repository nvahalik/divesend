#include <stdlib.h>
#include <string.h>
#include <strings.h>   /* strcasecmp */

#include <emscripten.h>

#include <libdivecomputer/context.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/iterator.h>
#include <libdivecomputer/parser.h>
#include <cJSON.h>

#include "webble_internal.h"

// The module keeps exactly one live allocation from this entry point: the
// string returned to JS. Freed at the top of the next call. Bounded, and a
// one-shot CLI never calls twice -- no per-call leak growth.
static char *g_raw_json = NULL;

static char *
set_result (char *owned)
{
	free (g_raw_json);
	g_raw_json = owned;
	return g_raw_json;
}

static int
name_eq (const char *a, const char *b)
{
	return a && b && strcasecmp (a, b) == 0;
}

EMSCRIPTEN_KEEPALIVE
char *
webble_decode_raw_to_json (const char *vendor, const char *product,
                           const unsigned char *data, int size)
{
	if (!product || !*product || !data || size <= 0) {
		return set_result (strdup ("{\"error\":\"invalid-args\"}"));
	}

	dc_context_t *context = NULL;
	if (dc_context_new (&context) != DC_STATUS_SUCCESS) {
		return set_result (NULL);
	}

	dc_iterator_t *iterator = NULL;
	if (dc_descriptor_iterator_new (&iterator, context) != DC_STATUS_SUCCESS) {
		dc_context_free (context);
		return set_result (NULL);
	}

	int vendor_given = vendor && *vendor;
	dc_descriptor_t *descriptor = NULL;
	dc_descriptor_t *match = NULL;
	while (dc_iterator_next (iterator, &descriptor) == DC_STATUS_SUCCESS) {
		if (name_eq (dc_descriptor_get_product (descriptor), product) &&
		    (!vendor_given || name_eq (dc_descriptor_get_vendor (descriptor), vendor))) {
			match = descriptor;   /* take ownership, stop scanning */
			break;
		}
		dc_descriptor_free (descriptor);
	}
	dc_iterator_free (iterator);

	if (!match) {
		dc_context_free (context);
		return set_result (strdup ("{\"error\":\"unsupported-model\"}"));
	}

	dc_parser_t *parser = NULL;
	dc_status_t status = dc_parser_new2 (&parser, context, match,
	                                     data, (size_t) size);
	if (status != DC_STATUS_SUCCESS) {
		dc_descriptor_free (match);
		dc_context_free (context);
		return set_result (strdup ("{\"error\":\"parse-failed\"}"));
	}

	char *json = NULL;
	status = build_dive_json (parser, data, (unsigned int) size, product, &json);

	dc_parser_destroy (parser);
	dc_descriptor_free (match);
	dc_context_free (context);

	if (status != DC_STATUS_SUCCESS || !json) {
		free (json);
		return set_result (strdup ("{\"error\":\"parse-failed\"}"));
	}
	return set_result (json);
}
