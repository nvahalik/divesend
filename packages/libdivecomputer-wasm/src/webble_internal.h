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

// descriptor_match.c
dc_descriptor_t *webble_resolve_ble_descriptor (dc_context_t *context, const char *device_name, int *out_is_fallback);

// device_session.c (Task 4)
dc_device_t *webble_current_device (void);
const char *webble_get_device_product (void);
void webble_close_device (void);

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
