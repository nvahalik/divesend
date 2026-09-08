// Regression test for device_session.c's single-slot event multiplexer.
//
// The device has exactly one dc_device_set_events() callback slot. Serial-number
// capture rides on DC_EVENT_DEVINFO, which for the Shearwater family only fires
// mid-download (inside dc_device_foreach). A 2026-09 regression added a
// progress-only re-subscription in dive_download.c right before the walk, which
// silently replaced the DEVINFO handler -- so every synced Shearwater dive went
// up with an empty serial and lost its manufacturer on the SSI side (showed as
// "Mares"). This test drives synthetic events through the same multiplexer the
// real download uses and asserts DEVINFO and PROGRESS coexist, in either order.
//
// Run via ./test.sh (emcc -> node). Exit non-zero on any failure.

#include <stdio.h>
#include <string.h>

#include <libdivecomputer/context.h>
#include <libdivecomputer/device.h>
#include <libdivecomputer/iostream.h>
#include <libdivecomputer/descriptor.h>

#include "../src/webble_internal.h"

// device_session.c pulls in these three externs through webble_open_device,
// which this test never calls. Stub them so the object links without dragging
// in ble_web.c (EM_ASYNC_JS / ASYNCIFY) or descriptor_match.c.
dc_context_t *webble_current_context (void) { return NULL; }
dc_iostream_t *webble_current_iostream (void) { return NULL; }
dc_descriptor_t *webble_resolve_ble_descriptor (dc_context_t *context, const char *device_name, int *out_is_fallback)
{
	(void) context; (void) device_name;
	if (out_is_fallback) *out_is_fallback = 0;
	return NULL;
}

static int g_failures = 0;
static int g_progress_hits = 0;
static unsigned int g_last_current = 0, g_last_maximum = 0;

static void
count_progress (unsigned int current, unsigned int maximum, void *userdata)
{
	(void) userdata;
	g_progress_hits++;
	g_last_current = current;
	g_last_maximum = maximum;
}

#define CHECK(cond, msg) do { \
	if (cond) { \
		printf ("  ok   %s\n", (msg)); \
	} else { \
		printf ("  FAIL %s\n", (msg)); \
		g_failures++; \
	} \
} while (0)

static void
feed_devinfo (unsigned int serial)
{
	dc_event_devinfo_t devinfo;
	memset (&devinfo, 0, sizeof (devinfo));
	devinfo.serial = serial;
	webble_session_dispatch_event (NULL, DC_EVENT_DEVINFO, &devinfo, NULL);
}

static void
feed_progress (unsigned int current, unsigned int maximum)
{
	dc_event_progress_t progress;
	memset (&progress, 0, sizeof (progress));
	progress.current = current;
	progress.maximum = maximum;
	webble_session_dispatch_event (NULL, DC_EVENT_PROGRESS, &progress, NULL);
}

static void
reset (void)
{
	// Clears g_have_devinfo / g_serial / the progress hook without needing an
	// open device.
	webble_close_device ();
	g_progress_hits = 0;
}

int
main (void)
{
	// 1. DEVINFO first, then a progress subscription + PROGRESS events: the
	//    serial captured earlier must survive (the regression clobbered it here).
	reset ();
	feed_devinfo (0x4C579D0Fu);
	CHECK (strcmp (webble_get_device_serial_hex (), "4C579D0F") == 0,
	       "serial captured from DC_EVENT_DEVINFO");
	webble_set_progress_hook (count_progress, NULL);
	feed_progress (10, 100);
	feed_progress (55, 100);
	CHECK (strcmp (webble_get_device_serial_hex (), "4C579D0F") == 0,
	       "serial still readable after progress events");
	CHECK (g_progress_hits == 2, "progress hook fired for each PROGRESS event");
	CHECK (g_last_current == 55 && g_last_maximum == 100, "progress hook got last values");

	// 2. Order independence: progress hook installed first, DEVINFO arrives
	//    later in the same walk (the real Shearwater ordering).
	reset ();
	webble_set_progress_hook (count_progress, NULL);
	feed_progress (1, 4);
	CHECK (webble_get_device_serial_hex ()[0] == '\0', "no serial before DEVINFO");
	feed_devinfo (0x00ABCDEFu);
	CHECK (strcmp (webble_get_device_serial_hex (), "00ABCDEF") == 0,
	       "DEVINFO still captured after a progress subscription");
	CHECK (g_progress_hits == 1, "progress hook unaffected by DEVINFO");

	// 3. Clearing the hook stops progress delivery but leaves DEVINFO capture
	//    intact (dive_download.c clears the hook when the walk returns).
	reset ();
	webble_set_progress_hook (count_progress, NULL);
	webble_set_progress_hook (NULL, NULL);
	feed_progress (2, 2);
	CHECK (g_progress_hits == 0, "no progress delivery after hook cleared");
	feed_devinfo (0x11u);
	CHECK (strcmp (webble_get_device_serial_hex (), "00000011") == 0,
	       "DEVINFO capture survives a cleared progress hook");

	// 4. A PROGRESS event with no hook installed must not crash.
	reset ();
	feed_progress (1, 1);
	CHECK (g_progress_hits == 0, "PROGRESS with no hook is a safe no-op");

	if (g_failures) {
		printf ("event_multiplex_test: %d failure(s)\n", g_failures);
		return 1;
	}
	printf ("event_multiplex_test: all checks passed\n");
	return 0;
}
