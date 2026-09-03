#ifndef WEBBLE_INTERNAL_H
#define WEBBLE_INTERNAL_H

#include <libdivecomputer/context.h>
#include <libdivecomputer/iostream.h>
#include <libdivecomputer/device.h>

// ble_web.c
dc_context_t *webble_current_context (void);
dc_iostream_t *webble_current_iostream (void);

// device_session.c (Task 4)
dc_device_t *webble_current_device (void);
const char *webble_get_device_product (void);
void webble_close_device (void);

// dive_decode.c (Task 5)
dc_status_t webble_decode_dive_to_json (const unsigned char *data, unsigned int size, dc_device_t *device, char **out_json);

#endif // WEBBLE_INTERNAL_H
