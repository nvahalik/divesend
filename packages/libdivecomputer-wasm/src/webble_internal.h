#ifndef WEBBLE_INTERNAL_H
#define WEBBLE_INTERNAL_H

#include <libdivecomputer/context.h>
#include <libdivecomputer/iostream.h>
#include <libdivecomputer/device.h>
#include <libdivecomputer/descriptor.h>
#include <libdivecomputer/parser.h>

// ble_web.c
dc_context_t *webble_current_context (void);
dc_iostream_t *webble_current_iostream (void);

// Renders a libdivecomputer log callback's fields into a single line
// ("[LEVEL] function: message"), always NUL-terminated, truncated to outsize.
// Split out from webble_log_cb so it can be unit-tested without the EM_JS
// dispatch (see test/log_bridge_test.c).
void webble_format_log_line (dc_loglevel_t level, const char *function, const char *message, char *out, size_t outsize);

// descriptor_match.c
dc_descriptor_t *webble_resolve_ble_descriptor (dc_context_t *context, const char *device_name, int *out_is_fallback);

// device_session.c (Task 4)
dc_device_t *webble_current_device (void);
const char *webble_get_device_product (void);
const char *webble_get_device_serial_hex (void);
void webble_close_device (void);

// device_session.c owns the device's single dc_device_set_events slot for the
// whole session (registered in webble_open_device, never re-set elsewhere) so
// that DC_EVENT_DEVINFO -- which carries the serial number and, for the
// Shearwater family, only fires mid-download -- can never be clobbered by a
// second subscriber. Other translation units that care about progress register
// a hook here instead of calling dc_device_set_events themselves.
typedef void (*webble_progress_fn) (unsigned int current, unsigned int maximum, void *userdata);
void webble_set_progress_hook (webble_progress_fn fn, void *userdata);

// Exposed for the C unit test: feed a synthetic libdivecomputer event through
// the same multiplexer dc_device_foreach would drive, without a real device.
void webble_session_dispatch_event (dc_device_t *device, dc_event_type_t event, const void *data, void *userdata);

// dive_decode.c (Task 5)
dc_status_t webble_decode_dive_to_json (const unsigned char *data, unsigned int size, dc_device_t *device, char **out_json);

/* dive_decode.c */
dc_status_t build_dive_json (dc_parser_t *parser, const unsigned char *data,
                             unsigned int size, const char *device_model,
                             char **out_json);

/* dive_inspect.c */
char *webble_decode_raw_to_json (const char *vendor, const char *product,
                                 const unsigned char *data, int size);

#endif // WEBBLE_INTERNAL_H
