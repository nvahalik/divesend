#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <libdivecomputer/parser.h>
#include <libdivecomputer/device.h>
#include <cJSON.h>

#include "webble_internal.h"

typedef struct {
	int timeS;
	double depthM;
	int has_depth;
	double tempC;
	int has_temp;
	int ndlS;
	int has_ndl;
	double tankPressureBar;
	int has_pressure;
	double decoStopDepthM;
	int has_decostop;
	int ttsS;
	int has_tts;
} sample_accum_t;

typedef struct {
	sample_accum_t *items;
	size_t count;
	size_t capacity;
} sample_list_t;

static void
sample_list_push (sample_list_t *list, sample_accum_t sample)
{
	if (list->count == list->capacity) {
		size_t new_capacity = list->capacity == 0 ? 64 : list->capacity * 2;
		sample_accum_t *grown = (sample_accum_t *) realloc (list->items, new_capacity * sizeof (sample_accum_t));
		if (!grown) {
			// Out of memory: drop this sample rather than write through a
			// NULL pointer. Losing one sample point on catastrophic OOM is
			// an acceptable degradation; the existing buffer (if any) is
			// left intact and usable.
			return;
		}
		list->items = grown;
		list->capacity = new_capacity;
	}
	list->items[list->count++] = sample;
}

typedef struct {
	sample_list_t list;
	sample_accum_t current;
	int have_current;
} sample_walk_state_t;

// libdivecomputer's samples_foreach fires one callback per field, in the
// order they occur within a single tick (DC_SAMPLE_TIME first, then that
// tick's depth/temperature/pressure/deco). Accumulate fields into `current`
// until the next DC_SAMPLE_TIME starts a new tick, then push the completed
// sample.
static void
sample_callback (dc_sample_type_t type, const dc_sample_value_t *value, void *userdata)
{
	sample_walk_state_t *state = (sample_walk_state_t *) userdata;

	if (type == DC_SAMPLE_TIME) {
		if (state->have_current) {
			sample_list_push (&state->list, state->current);
		}
		memset (&state->current, 0, sizeof (state->current));
		state->current.timeS = (int) (value->time / 1000);
		state->have_current = 1;
		return;
	}

	if (!state->have_current) {
		return;
	}

	switch (type) {
	case DC_SAMPLE_DEPTH:
		state->current.depthM = value->depth;
		state->current.has_depth = 1;
		break;
	case DC_SAMPLE_TEMPERATURE:
		state->current.tempC = value->temperature;
		state->current.has_temp = 1;
		break;
	case DC_SAMPLE_PRESSURE:
		state->current.tankPressureBar = value->pressure.value;
		state->current.has_pressure = 1;
		break;
	case DC_SAMPLE_DECO:
		if (value->deco.type == DC_DECO_NDL) {
			state->current.ndlS = (int) value->deco.time;
			state->current.has_ndl = 1;
			// Matches ShearwaterDiveDecoder.swift: while cruising with no
			// required stop, treat "in NDL state" as an explicit 0.0m stop,
			// not absent data.
			state->current.decoStopDepthM = 0.0;
			state->current.has_decostop = 1;
		} else if (value->deco.type == DC_DECO_DECOSTOP) {
			state->current.decoStopDepthM = value->deco.depth;
			state->current.has_decostop = 1;
		}
		state->current.ttsS = (int) value->deco.tts;
		state->current.has_tts = 1;
		break;
	default:
		break;
	}
}

static const char *
divemode_to_string (dc_divemode_t mode)
{
	switch (mode) {
	case DC_DIVEMODE_FREEDIVE: return "freedive";
	case DC_DIVEMODE_GAUGE: return "gauge";
	case DC_DIVEMODE_OC: return "oc";
	case DC_DIVEMODE_CCR: return "ccr";
	case DC_DIVEMODE_SCR: return "scr";
	default: return "oc";
	}
}

static const char *
decomodel_to_string (dc_decomodel_type_t type)
{
	switch (type) {
	case DC_DECOMODEL_NONE: return "none";
	case DC_DECOMODEL_BUHLMANN: return "buhlmann";
	case DC_DECOMODEL_VPM: return "vpm";
	case DC_DECOMODEL_RGBM: return "rgbm";
	case DC_DECOMODEL_DCIEM: return "dciem";
	default: return "none";
	}
}

dc_status_t
webble_decode_dive_to_json (const unsigned char *data, unsigned int size, dc_device_t *device, char **out_json)
{
	*out_json = NULL;

	dc_parser_t *parser = NULL;
	dc_status_t status = dc_parser_new (&parser, device, data, size);
	if (status != DC_STATUS_SUCCESS) {
		return status;
	}

	dc_datetime_t dt = {0};
	dc_parser_get_datetime (parser, &dt);

	unsigned int divetime = 0;
	dc_parser_get_field (parser, DC_FIELD_DIVETIME, 0, &divetime);

	double maxdepth = 0.0;
	dc_parser_get_field (parser, DC_FIELD_MAXDEPTH, 0, &maxdepth);

	unsigned int gasmix_count = 0;
	dc_parser_get_field (parser, DC_FIELD_GASMIX_COUNT, 0, &gasmix_count);
	dc_gasmix_t gasmix = {0};
	gasmix.oxygen = 0.21;
	gasmix.helium = 0.0;
	if (gasmix_count > 0) {
		dc_parser_get_field (parser, DC_FIELD_GASMIX, 0, &gasmix);
	}

	unsigned int tank_count = 0;
	dc_parser_get_field (parser, DC_FIELD_TANK_COUNT, 0, &tank_count);
	dc_tank_t tank = {0};
	if (tank_count > 0) {
		dc_parser_get_field (parser, DC_FIELD_TANK, 0, &tank);
	}

	dc_salinity_t salinity = {0};
	salinity.type = DC_WATER_SALT; // default, matches ShearwaterDiveDecoder.swift's fallback
	dc_parser_get_field (parser, DC_FIELD_SALINITY, 0, &salinity);

	double temp_min = 0.0, temp_max = 0.0;
	int have_temp_min = dc_parser_get_field (parser, DC_FIELD_TEMPERATURE_MINIMUM, 0, &temp_min) == DC_STATUS_SUCCESS;
	int have_temp_max = dc_parser_get_field (parser, DC_FIELD_TEMPERATURE_MAXIMUM, 0, &temp_max) == DC_STATUS_SUCCESS;

	dc_divemode_t divemode = DC_DIVEMODE_OC;
	dc_parser_get_field (parser, DC_FIELD_DIVEMODE, 0, &divemode);

	dc_decomodel_t decomodel = {0};
	int have_decomodel = dc_parser_get_field (parser, DC_FIELD_DECOMODEL, 0, &decomodel) == DC_STATUS_SUCCESS;

	sample_walk_state_t walk = {0};
	dc_parser_samples_foreach (parser, sample_callback, &walk);
	if (walk.have_current) {
		sample_list_push (&walk.list, walk.current);
	}

	dc_parser_destroy (parser);

	cJSON *root = cJSON_CreateObject ();
	cJSON *header = cJSON_CreateObject ();
	cJSON_AddItemToObject (root, "header", header);

	// dt.{year..second} is the dive computer's wall-clock reading. For most
	// devices dt.timezone is DC_TIMEZONE_NONE (no known relationship to UTC,
	// and the field is trusted as-is -- existing behavior, unchanged below).
	// A handful of devices (Divesoft Freedom, Deep6 Excursion, Halcyon
	// Symbios, Dive System iDive) report the *diver-configured* UTC offset
	// in dt.timezone; for those, the wall-clock fields are local time, not
	// UTC, and must be shifted before we're allowed to call it "Z". Mirrors
	// libdivecomputer's own dc_datetime_localtime (datetime.c): treat the
	// fields as UTC first via timegm, then subtract the device's offset to
	// land on true UTC. Skip this (or get the sign backwards) and every
	// dive from a timezone-aware device is mislabeled by exactly that
	// offset once downstream code takes the trailing "Z" at face value.
	struct tm tm = {0};
	tm.tm_year = dt.year - 1900;
	tm.tm_mon = dt.month - 1;
	tm.tm_mday = dt.day;
	tm.tm_hour = dt.hour;
	tm.tm_min = dt.minute;
	tm.tm_sec = dt.second;
	time_t utc_ticks = timegm (&tm);
	if (dt.timezone != DC_TIMEZONE_NONE) {
		utc_ticks -= dt.timezone;
	}
	struct tm utc_tm;
	gmtime_r (&utc_ticks, &utc_tm);

	char start_time[32];
	snprintf (start_time, sizeof (start_time), "%04d-%02d-%02dT%02d:%02d:%02dZ",
		utc_tm.tm_year + 1900, utc_tm.tm_mon + 1, utc_tm.tm_mday,
		utc_tm.tm_hour, utc_tm.tm_min, utc_tm.tm_sec);
	cJSON_AddStringToObject (header, "startTime", start_time);
	cJSON_AddNumberToObject (header, "maxDepthM", maxdepth);
	cJSON_AddNumberToObject (header, "gasO2Percent", gasmix.oxygen * 100.0);
	cJSON_AddNumberToObject (header, "gasHePercent", gasmix.helium * 100.0);
	if (tank_count > 0) {
		cJSON_AddNumberToObject (header, "tankBeginPressureBar", tank.beginpressure);
		cJSON_AddNumberToObject (header, "tankEndPressureBar", tank.endpressure);
	} else {
		cJSON_AddNullToObject (header, "tankBeginPressureBar");
		cJSON_AddNullToObject (header, "tankEndPressureBar");
	}
	cJSON_AddStringToObject (header, "diveMode", divemode_to_string (divemode));
	cJSON_AddStringToObject (header, "decoModel", have_decomodel ? decomodel_to_string (decomodel.type) : "none");
	cJSON_AddNumberToObject (header, "gfLow", have_decomodel ? (double) decomodel.params.gf.low : 0);
	cJSON_AddNumberToObject (header, "gfHigh", have_decomodel ? (double) decomodel.params.gf.high : 0);
	cJSON_AddStringToObject (header, "salinity", salinity.type == DC_WATER_SALT ? "salt" : "fresh");
	cJSON_AddStringToObject (header, "deviceModel", webble_get_device_product ());
	cJSON_AddNumberToObject (header, "divetimeS", (double) divetime);
	if (have_temp_min) {
		cJSON_AddNumberToObject (header, "minTemperatureC", temp_min);
	} else {
		cJSON_AddNullToObject (header, "minTemperatureC");
	}
	if (have_temp_max) {
		cJSON_AddNumberToObject (header, "maxTemperatureC", temp_max);
	} else {
		cJSON_AddNullToObject (header, "maxTemperatureC");
	}
	cJSON_AddNullToObject (header, "cnsPercent"); // no DC_FIELD_CNS in libdivecomputer's public API

	cJSON *samples = cJSON_CreateArray ();
	cJSON_AddItemToObject (root, "samples", samples);
	for (size_t i = 0; i < walk.list.count; i++) {
		sample_accum_t *s = &walk.list.items[i];
		cJSON *sample = cJSON_CreateObject ();
		cJSON_AddNumberToObject (sample, "timeS", s->timeS);
		cJSON_AddNumberToObject (sample, "depthM", s->has_depth ? s->depthM : 0.0);
		if (s->has_temp) { cJSON_AddNumberToObject (sample, "tempC", s->tempC); } else { cJSON_AddNullToObject (sample, "tempC"); }
		if (s->has_ndl) { cJSON_AddNumberToObject (sample, "ndlS", s->ndlS); } else { cJSON_AddNullToObject (sample, "ndlS"); }
		if (s->has_pressure) { cJSON_AddNumberToObject (sample, "tankPressureBar", s->tankPressureBar); } else { cJSON_AddNullToObject (sample, "tankPressureBar"); }
		if (s->has_decostop) { cJSON_AddNumberToObject (sample, "decoStopDepthM", s->decoStopDepthM); } else { cJSON_AddNullToObject (sample, "decoStopDepthM"); }
		if (s->has_tts) { cJSON_AddNumberToObject (sample, "ttsS", s->ttsS); } else { cJSON_AddNullToObject (sample, "ttsS"); }
		cJSON_AddItemToArray (samples, sample);
	}

	free (walk.list.items);

	char *json_str = cJSON_PrintUnformatted (root);
	cJSON_Delete (root);

	*out_json = json_str;
	return DC_STATUS_SUCCESS;
}
