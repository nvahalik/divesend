#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <emscripten.h>

#include <libdivecomputer/custom.h>
#include <libdivecomputer/context.h>
#include <libdivecomputer/iostream.h>

#include "webble_internal.h"

// JS-side async read: awaits Module.webble.read(), which resolves with a
// Uint8Array of the next queued BLE notification, or null on timeout.
// Copies at most `size` bytes into `data` and returns the number copied,
// or -1 if the read timed out / no data arrived.
EM_ASYNC_JS(int, webble_js_read, (uint8_t *data, int size), {
	const bytes = await Module.webble.read(size);
	if (!bytes || bytes.length === 0) {
		return -1;
	}
	const n = Math.min(bytes.length, size);
	HEAPU8.set(bytes.subarray(0, n), data);
	return n;
});

// JS-side async write: awaits Module.webble.write(), which performs a GATT
// characteristic write. Returns 1 on success, 0 on failure.
EM_ASYNC_JS(int, webble_js_write, (const uint8_t *data, int size), {
	const bytes = HEAPU8.slice(data, data + size);
	const ok = await Module.webble.write(bytes);
	return ok ? 1 : 0;
});

static dc_status_t
custom_read (void *userdata, void *data, size_t size, size_t *actual)
{
	int n = webble_js_read((uint8_t *) data, (int) size);
	if (n < 0) {
		*actual = 0;
		return DC_STATUS_TIMEOUT;
	}
	*actual = (size_t) n;
	return DC_STATUS_SUCCESS;
}

static dc_status_t
custom_write (void *userdata, const void *data, size_t size, size_t *actual)
{
	int ok = webble_js_write((const uint8_t *) data, (int) size);
	if (!ok) {
		*actual = 0;
		return DC_STATUS_IO;
	}
	*actual = size;
	return DC_STATUS_SUCCESS;
}

static dc_status_t
custom_set_timeout (void *userdata, int timeout)
{
	return DC_STATUS_SUCCESS;
}

static dc_status_t
custom_sleep (void *userdata, unsigned int milliseconds)
{
	return DC_STATUS_SUCCESS;
}

static dc_status_t
custom_close (void *userdata)
{
	return DC_STATUS_SUCCESS;
}

static const dc_custom_cbs_t callbacks = {
	.set_timeout = custom_set_timeout,
	.set_break = NULL,
	.set_dtr = NULL,
	.set_rts = NULL,
	.get_lines = NULL,
	.get_available = NULL,
	.configure = NULL,
	.poll = NULL,
	.read = custom_read,
	.write = custom_write,
	.ioctl = NULL,
	.flush = NULL,
	.purge = NULL,
	.sleep = custom_sleep,
	.close = custom_close,
};

static const char *
loglevel_label (dc_loglevel_t level)
{
	switch (level) {
	case DC_LOGLEVEL_ERROR:   return "ERROR";
	case DC_LOGLEVEL_WARNING: return "WARN";
	case DC_LOGLEVEL_INFO:    return "INFO";
	case DC_LOGLEVEL_DEBUG:   return "DEBUG";
	case DC_LOGLEVEL_ALL:     return "ALL";
	case DC_LOGLEVEL_NONE:    return "NONE";
	default:                  return "?";
	}
}

void
webble_format_log_line (dc_loglevel_t level, const char *function, const char *message, char *out, size_t outsize)
{
	if (outsize == 0) {
		return;
	}
	snprintf (out, outsize, "[%s] %s: %s",
	          loglevel_label (level),
	          function ? function : "(nofn)",
	          message ? message : "");
	out[outsize - 1] = '\0';
}

// Bridges every libdivecomputer log line to JS. Runs inside libdivecomputer
// (often mid-dc_device_foreach), so it must not allocate, must not call back
// into libdivecomputer, and must only format into a stack buffer + hand the
// string to JS. file/line are dropped deliberately -- function + message is
// enough to follow a handshake and keeps each line short.
EM_JS(void, webble_js_on_log, (int level, const char *line), {
	if (Module.webble && Module.webble.onLog) {
		Module.webble.onLog(level, UTF8ToString(line));
	}
});

static void
webble_log_cb (dc_context_t *context, dc_loglevel_t loglevel, const char *file, unsigned int line,
               const char *function, const char *message, void *userdata)
{
	(void) context; (void) file; (void) line; (void) userdata;
	char buf[1024];
	webble_format_log_line (loglevel, function, message, buf, sizeof (buf));
	webble_js_on_log ((int) loglevel, buf);
}

static dc_context_t *g_context = NULL;
static dc_iostream_t *g_iostream = NULL;

void webble_close (void);

// Self-guards against a stale prior session the same way
// device_session.c's webble_open_device() does -- calling webble_open()
// twice without an intervening webble_close() used to silently allocate a
// second context/iostream on top of the first, leaking the old ones and
// leaving the underlying device's BLE session state confused (confirmed
// against real Shearwater hardware: a second connect's dc_device_foreach
// consistently failed once a stale session was left open this way).
EMSCRIPTEN_KEEPALIVE
int
webble_open (void)
{
	if (g_context || g_iostream) {
		webble_close ();
	}

	if (dc_context_new (&g_context) != DC_STATUS_SUCCESS) {
		return -1;
	}
	dc_context_set_loglevel (g_context, DC_LOGLEVEL_ALL);
	dc_context_set_logfunc (g_context, webble_log_cb, NULL);
	if (dc_custom_open (&g_iostream, g_context, DC_TRANSPORT_BLE, &callbacks, NULL) != DC_STATUS_SUCCESS) {
		return -2;
	}
	return 0;
}

// Closes the device layer before the transport it depends on -- device_close
// sends a real protocol write (e.g. Shearwater's "exit command mode") over
// the still-open iostream, so closing the iostream first would leave that
// write with nothing to go out on. Cascading this here (rather than relying
// on every caller to sequence webble_close_device() then webble_close()
// correctly, as main.js originally had to) means the ordering invariant is
// enforced where the consequence lives, not just documented at each call site.
EMSCRIPTEN_KEEPALIVE
void
webble_close (void)
{
	webble_close_device ();

	if (g_iostream) {
		dc_iostream_close (g_iostream);
		g_iostream = NULL;
	}
	if (g_context) {
		dc_context_free (g_context);
		g_context = NULL;
	}
}

dc_context_t *
webble_current_context (void)
{
	return g_context;
}

dc_iostream_t *
webble_current_iostream (void)
{
	return g_iostream;
}
