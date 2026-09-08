// Verifies webble_format_log_line() (ble_web.c) renders a libdivecomputer log
// callback's arguments into the one-line form the JS side ingests. The EM_JS
// dispatch in webble_log_cb() is verified manually (connect to a real device,
// confirm "[dc]" lines appear in the diagnostics export).
//
// Run via ./test.sh (emcc -> node). Exit non-zero on any failure.

#include <stdio.h>
#include <string.h>

#include <libdivecomputer/context.h>

#include "../src/webble_internal.h"

static int g_failures = 0;

#define CHECK(cond, msg) do { \
	if (cond) { \
		printf ("  ok   %s\n", (msg)); \
	} else { \
		printf ("  FAIL %s\n", (msg)); \
		g_failures++; \
	} \
} while (0)

int
main (void)
{
	char buf[64];

	webble_format_log_line (DC_LOGLEVEL_INFO, "shearwater_common_download", "packet 12 bytes", buf, sizeof (buf));
	CHECK (strcmp (buf, "[INFO] shearwater_common_download: packet 12 bytes") == 0, "formats level + function + message");

	webble_format_log_line (DC_LOGLEVEL_ERROR, "dc_iostream_read", "timeout", buf, sizeof (buf));
	CHECK (strcmp (buf, "[ERROR] dc_iostream_read: timeout") == 0, "ERROR level label");

	// NULL function/message must not crash and must still produce a line.
	webble_format_log_line (DC_LOGLEVEL_DEBUG, NULL, NULL, buf, sizeof (buf));
	CHECK (strncmp (buf, "[DEBUG] ", 8) == 0, "tolerates NULL function/message");

	// Truncation: tiny buffer stays NUL-terminated and within bounds.
	char tiny[10];
	memset (tiny, 'x', sizeof (tiny));
	webble_format_log_line (DC_LOGLEVEL_WARNING, "some_function", "a very long message that will not fit", tiny, sizeof (tiny));
	CHECK (tiny[9] == '\0', "truncated output is NUL-terminated at outsize-1");
	CHECK (strlen (tiny) == 9, "truncated output fills exactly outsize-1");

	// An out-of-range level must not read past the label table.
	webble_format_log_line ((dc_loglevel_t) 99, "fn", "msg", buf, sizeof (buf));
	CHECK (strncmp (buf, "[?] ", 4) == 0, "unknown level renders as [?]");

	printf (g_failures ? "FAILED (%d)\n" : "PASSED\n", g_failures);
	return g_failures ? 1 : 0;
}
