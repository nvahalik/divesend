#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <libdivecomputer/parser.h>
#include <libdivecomputer/device.h>
#include <cJSON.h>

#include "webble_internal.h"

// A tick can carry more than one event (e.g. a gas violation and a ceiling
// alarm in the same second) -- 8 is generous headroom over anything a real
// device emits per tick, so a plain fixed array beats a nested dynamic list.
#define SAMPLE_MAX_EVENTS 8

// Capped at 8 -- generous headroom over any real dive computer's gas/tank
// count (tech/CCR dives with 4-6 mixes or tanks are already an extreme
// case), and keeps these fixed-size stack arrays instead of heap allocs.
#define MAX_GASMIXES 8
#define MAX_TANKS 8

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
	int gasMixIndex;
	int has_gasmix;
	int heartRateBpm;
	int has_heartbeat;
	double setpointBar;
	int has_setpoint;
	double ppo2Bar;
	int has_ppo2;
	double cnsPercent;
	int has_cns;
	int remainingBottomTimeMin;
	int has_rbt;
	int bearingDeg;
	int has_bearing;
	const char *events[SAMPLE_MAX_EVENTS];
	int event_count;
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

static const char *
sample_event_to_string (unsigned int type)
{
	switch ((parser_sample_event_t) type) {
	case SAMPLE_EVENT_DECOSTOP: return "decostop";
	case SAMPLE_EVENT_RBT: return "rbt";
	case SAMPLE_EVENT_ASCENT: return "ascent";
	case SAMPLE_EVENT_CEILING: return "ceiling";
	case SAMPLE_EVENT_WORKLOAD: return "workload";
	case SAMPLE_EVENT_TRANSMITTER: return "transmitter";
	case SAMPLE_EVENT_VIOLATION: return "violation";
	case SAMPLE_EVENT_BOOKMARK: return "bookmark";
	case SAMPLE_EVENT_SURFACE: return "surface";
	case SAMPLE_EVENT_SAFETYSTOP: return "safetystop";
	case SAMPLE_EVENT_SAFETYSTOP_VOLUNTARY: return "safetystop_voluntary";
	case SAMPLE_EVENT_SAFETYSTOP_MANDATORY: return "safetystop_mandatory";
	case SAMPLE_EVENT_DEEPSTOP: return "deepstop";
	case SAMPLE_EVENT_CEILING_SAFETYSTOP: return "ceiling_safetystop";
	case SAMPLE_EVENT_FLOOR: return "floor";
	case SAMPLE_EVENT_DIVETIME: return "divetime";
	case SAMPLE_EVENT_MAXDEPTH: return "maxdepth";
	case SAMPLE_EVENT_OLF: return "olf";
	case SAMPLE_EVENT_PO2: return "po2";
	case SAMPLE_EVENT_AIRTIME: return "airtime";
	case SAMPLE_EVENT_RGBM: return "rgbm";
	case SAMPLE_EVENT_TISSUELEVEL: return "tissuelevel";
	// GASCHANGE/GASCHANGE2 and HEADING are libdivecomputer's own deprecated
	// aliases for DC_SAMPLE_GASMIX/DC_SAMPLE_BEARING -- both already handled
	// as their own sample types below, so surfacing them again here would
	// double-report the same moment under two different names.
	case SAMPLE_EVENT_GASCHANGE:
	case SAMPLE_EVENT_GASCHANGE2:
	case SAMPLE_EVENT_HEADING:
	case SAMPLE_EVENT_NONE:
	default:
		return NULL;
	}
}

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
	case DC_SAMPLE_GASMIX:
		state->current.gasMixIndex = (int) value->gasmix;
		state->current.has_gasmix = 1;
		break;
	case DC_SAMPLE_HEARTBEAT:
		state->current.heartRateBpm = (int) value->heartbeat;
		state->current.has_heartbeat = 1;
		break;
	case DC_SAMPLE_SETPOINT:
		state->current.setpointBar = value->setpoint;
		state->current.has_setpoint = 1;
		break;
	case DC_SAMPLE_PPO2:
		// A rebreather can report more than one O2 sensor per tick
		// (value->ppo2.sensor); like tankPressureBar above, we keep a single
		// scalar and let the last sensor reported in the tick win rather
		// than modeling a per-sensor array here.
		state->current.ppo2Bar = value->ppo2.value;
		state->current.has_ppo2 = 1;
		break;
	case DC_SAMPLE_CNS:
		state->current.cnsPercent = value->cns * 100.0;
		state->current.has_cns = 1;
		break;
	case DC_SAMPLE_RBT:
		state->current.remainingBottomTimeMin = (int) value->rbt;
		state->current.has_rbt = 1;
		break;
	case DC_SAMPLE_BEARING:
		state->current.bearingDeg = (int) value->bearing;
		state->current.has_bearing = 1;
		break;
	case DC_SAMPLE_EVENT: {
		const char *name = sample_event_to_string (value->event.type);
		if (name && state->current.event_count < SAMPLE_MAX_EVENTS) {
			state->current.events[state->current.event_count++] = name;
		}
		break;
	}
	// DC_SAMPLE_VENDOR is an opaque, vendor-specific binary blob with no
	// generic meaning to decode into JSON. DC_SAMPLE_LOCATION (per-sample
	// GPS) has no known emitter anywhere in the vendored parsers as of this
	// writing -- nothing to wire up yet, and speculative plumbing for a
	// field no device actually sends isn't worth the surface area.
	default:
		break;
	}
}

// Duplicated from dive_download.c's static helper of the same shape (that
// one is file-local there) -- small enough that sharing it via the header
// isn't worth the churn. Encodes the raw device buffer verbatim so a later
// "export raw dive data" feature can hand back exactly what libdivecomputer
// gave dc_parser_new, unmodified.
static char *
raw_hex_encode (const unsigned char *bytes, unsigned int size)
{
	char *hex = (char *) malloc (size * 2 + 1);
	if (!hex) {
		return NULL;
	}
	for (unsigned int i = 0; i < size; i++) {
		snprintf (hex + i * 2, 3, "%02x", bytes[i]);
	}
	hex[size * 2] = '\0';
	return hex;
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

// dc_datetime_t.timezone is not a single well-defined contract across
// libdivecomputer's parsers -- reading each implementation directly (there is
// no other way to know) turned up two genuinely different meanings:
//
//   Pattern A: dt.{year..second} are the device's LOCAL wall-clock reading;
//   dt.timezone is the offset to SUBTRACT to reach true UTC. Confirmed by
//   reading the source for divesoft_freedom, deepsix_excursion,
//   halcyon_symbios, and divesystem_idive -- each builds its internal
//   `ticks` as (raw device counter) + timezone_offset *before* handing it to
//   dc_datetime_gmtime (or, for deepsix, copies raw local-clock byte fields
//   directly with no gmtime step at all).
//
//   Pattern B: dt.{year..second} are already true UTC; dt.timezone is
//   purely informational (the offset the diver configured for the device's
//   own on-screen display), unrelated to how the calendar fields were
//   computed. Confirmed for shearwater_predator/petrel (the Perdix/
//   Peregrine family): it calls dc_datetime_gmtime on the raw device tick
//   count with NO timezone adjustment, then sets dt.timezone afterward as a
//   separate, unrelated field.
//
//   Exception within the petrel family: the Teric specifically IS pattern A,
//   confirmed by live testing (a Teric's reported "UTC" startTime matched the
//   diver's local wall clock, not true UTC). shearwater_predator_parser.c
//   only ever sets a non-DC_TIMEZONE_NONE timezone for model == TERIC (with
//   logversion >= 9) -- every other device in the family always reports
//   DC_TIMEZONE_NONE. So listing the whole family below only changes
//   behavior for the Teric; the guard on dt.timezone != DC_TIMEZONE_NONE
//   below leaves Perdix/Peregrine/etc. exactly as before.
//
// Applying pattern A's subtraction to a pattern B device (or vice versa)
// doesn't just fail to fix anything -- it MISLABELS an already-correct
// timestamp by the full offset, which is worse than doing nothing. So this
// is an explicit allowlist of families verified as pattern A, not a
// blocklist of known-bad ones: anything not on this list keeps its
// dt.{year..second} exactly as read, same as before this correction existed.
static int
parser_uses_local_datetime_with_timezone_field (dc_parser_t *parser)
{
	switch (dc_parser_get_type (parser)) {
	case DC_FAMILY_DIVESOFT_FREEDOM:
	case DC_FAMILY_DEEPSIX_EXCURSION:
	case DC_FAMILY_HALCYON_SYMBIOS:
	case DC_FAMILY_DIVESYSTEM_IDIVE:
	case DC_FAMILY_SHEARWATER_PETREL: // only actually applies to Teric -- see above
		return 1;
	default:
		return 0;
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
	int dt_is_local_with_timezone = parser_uses_local_datetime_with_timezone_field (parser);

	unsigned int divetime = 0;
	dc_parser_get_field (parser, DC_FIELD_DIVETIME, 0, &divetime);

	double maxdepth = 0.0;
	dc_parser_get_field (parser, DC_FIELD_MAXDEPTH, 0, &maxdepth);

	unsigned int gasmix_count = 0;
	dc_parser_get_field (parser, DC_FIELD_GASMIX_COUNT, 0, &gasmix_count);
	dc_gasmix_t gasmixes[MAX_GASMIXES];
	unsigned int gasmixes_read = gasmix_count < MAX_GASMIXES ? gasmix_count : MAX_GASMIXES;
	for (unsigned int i = 0; i < gasmixes_read; i++) {
		gasmixes[i].oxygen = 0.21;
		gasmixes[i].helium = 0.0;
		dc_parser_get_field (parser, DC_FIELD_GASMIX, i, &gasmixes[i]);
	}
	// header.gasO2Percent/gasHePercent are the pre-existing single-mix
	// convenience fields -- kept exactly as before (mix 0, or air if the
	// device reports none) so nothing that already reads them breaks.
	dc_gasmix_t gasmix = {0};
	gasmix.oxygen = 0.21;
	gasmix.helium = 0.0;
	if (gasmixes_read > 0) {
		gasmix = gasmixes[0];
	}

	unsigned int tank_count = 0;
	dc_parser_get_field (parser, DC_FIELD_TANK_COUNT, 0, &tank_count);
	dc_tank_t tanks[MAX_TANKS];
	unsigned int tanks_read = tank_count < MAX_TANKS ? tank_count : MAX_TANKS;
	for (unsigned int i = 0; i < tanks_read; i++) {
		memset (&tanks[i], 0, sizeof (tanks[i]));
		dc_parser_get_field (parser, DC_FIELD_TANK, i, &tanks[i]);
	}
	// header.tankBeginPressureBar/tankEndPressureBar are the pre-existing
	// single-tank convenience fields -- kept exactly as before (tank 0).
	dc_tank_t tank = {0};
	if (tanks_read > 0) {
		tank = tanks[0];
	}

	double avgdepth = 0.0;
	int have_avgdepth = dc_parser_get_field (parser, DC_FIELD_AVGDEPTH, 0, &avgdepth) == DC_STATUS_SUCCESS;

	double atmospheric = 0.0;
	int have_atmospheric = dc_parser_get_field (parser, DC_FIELD_ATMOSPHERIC, 0, &atmospheric) == DC_STATUS_SUCCESS;

	double temp_surface = 0.0;
	int have_temp_surface = dc_parser_get_field (parser, DC_FIELD_TEMPERATURE_SURFACE, 0, &temp_surface) == DC_STATUS_SUCCESS;

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

	// dt.{year..second} is the dive computer's wall-clock reading. On the
	// pattern-A families (see parser_uses_local_datetime_with_timezone_field
	// above), those fields are local time and dt.timezone must be subtracted
	// to land on true UTC before we're allowed to call it "Z" -- mirrors
	// libdivecomputer's own dc_datetime_localtime (datetime.c): treat the
	// fields as UTC first via timegm, then subtract the device's offset.
	// Everywhere else (including DC_TIMEZONE_NONE devices, and pattern-B
	// families like Shearwater where the fields are already true UTC),
	// dt.{year..second} is used exactly as read -- unchanged from before
	// this correction existed.
	struct tm tm = {0};
	tm.tm_year = dt.year - 1900;
	tm.tm_mon = dt.month - 1;
	tm.tm_mday = dt.day;
	tm.tm_hour = dt.hour;
	tm.tm_min = dt.minute;
	tm.tm_sec = dt.second;
	time_t utc_ticks = timegm (&tm);
	if (dt_is_local_with_timezone && dt.timezone != DC_TIMEZONE_NONE) {
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

	if (have_avgdepth) {
		cJSON_AddNumberToObject (header, "avgDepthM", avgdepth);
	} else {
		cJSON_AddNullToObject (header, "avgDepthM");
	}
	if (have_atmospheric) {
		cJSON_AddNumberToObject (header, "surfacePressureBar", atmospheric);
	} else {
		cJSON_AddNullToObject (header, "surfacePressureBar");
	}
	if (have_temp_surface) {
		cJSON_AddNumberToObject (header, "surfaceTemperatureC", temp_surface);
	} else {
		cJSON_AddNullToObject (header, "surfaceTemperatureC");
	}

	// Full gas-mix / tank lists, alongside the single-mix/single-tank
	// convenience fields above -- see the comments where gasmixes[]/tanks[]
	// were read for why those older fields stay pointed at index 0.
	cJSON *gas_mixes_json = cJSON_CreateArray ();
	cJSON_AddItemToObject (header, "gasMixes", gas_mixes_json);
	for (unsigned int i = 0; i < gasmixes_read; i++) {
		cJSON *mix = cJSON_CreateObject ();
		cJSON_AddNumberToObject (mix, "o2Percent", gasmixes[i].oxygen * 100.0);
		cJSON_AddNumberToObject (mix, "hePercent", gasmixes[i].helium * 100.0);
		cJSON_AddItemToArray (gas_mixes_json, mix);
	}

	cJSON *tanks_json = cJSON_CreateArray ();
	cJSON_AddItemToObject (header, "tanks", tanks_json);
	for (unsigned int i = 0; i < tanks_read; i++) {
		cJSON *tank_json = cJSON_CreateObject ();
		cJSON_AddNumberToObject (tank_json, "beginPressureBar", tanks[i].beginpressure);
		cJSON_AddNumberToObject (tank_json, "endPressureBar", tanks[i].endpressure);
		if (tanks[i].gasmix == DC_GASMIX_UNKNOWN) {
			cJSON_AddNullToObject (tank_json, "gasMixIndex");
		} else {
			cJSON_AddNumberToObject (tank_json, "gasMixIndex", (double) tanks[i].gasmix);
		}
		cJSON_AddItemToArray (tanks_json, tank_json);
	}

	cJSON *samples = cJSON_CreateArray ();
	cJSON_AddItemToObject (root, "samples", samples);
	// No DC_FIELD_CNS exists at the header level -- approximate "CNS for the
	// whole dive" as the last per-sample DC_SAMPLE_CNS value seen (CNS is
	// cumulative over the dive, so the last sample's reading is the dive
	// total), on whichever device reports it at all.
	int have_final_cns = 0;
	double final_cns = 0.0;
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
		if (s->has_gasmix) { cJSON_AddNumberToObject (sample, "gasMixIndex", s->gasMixIndex); } else { cJSON_AddNullToObject (sample, "gasMixIndex"); }
		if (s->has_heartbeat) { cJSON_AddNumberToObject (sample, "heartRateBpm", s->heartRateBpm); } else { cJSON_AddNullToObject (sample, "heartRateBpm"); }
		if (s->has_setpoint) { cJSON_AddNumberToObject (sample, "setpointBar", s->setpointBar); } else { cJSON_AddNullToObject (sample, "setpointBar"); }
		if (s->has_ppo2) { cJSON_AddNumberToObject (sample, "ppo2Bar", s->ppo2Bar); } else { cJSON_AddNullToObject (sample, "ppo2Bar"); }
		if (s->has_cns) {
			cJSON_AddNumberToObject (sample, "cnsPercent", s->cnsPercent);
			have_final_cns = 1;
			final_cns = s->cnsPercent;
		} else {
			cJSON_AddNullToObject (sample, "cnsPercent");
		}
		if (s->has_rbt) { cJSON_AddNumberToObject (sample, "remainingBottomTimeMin", s->remainingBottomTimeMin); } else { cJSON_AddNullToObject (sample, "remainingBottomTimeMin"); }
		if (s->has_bearing) { cJSON_AddNumberToObject (sample, "bearingDeg", s->bearingDeg); } else { cJSON_AddNullToObject (sample, "bearingDeg"); }
		cJSON *events_json = cJSON_CreateArray ();
		for (int e = 0; e < s->event_count; e++) {
			cJSON_AddItemToArray (events_json, cJSON_CreateString (s->events[e]));
		}
		cJSON_AddItemToObject (sample, "events", events_json);
		cJSON_AddItemToArray (samples, sample);
	}

	free (walk.list.items);

	if (have_final_cns) {
		cJSON_AddNumberToObject (header, "cnsPercent", final_cns);
	} else {
		cJSON_AddNullToObject (header, "cnsPercent"); // device reports no DC_SAMPLE_CNS at all
	}

	// Verbatim hex of the exact buffer dc_parser_new was given -- purely for
	// "export raw dive data" round-tripping, not for any parsing/decoding
	// use. Top-level on root (not header), matching CanonicalDive.rawDataHex.
	char *raw_hex = raw_hex_encode (data, size);
	if (raw_hex) {
		cJSON_AddStringToObject (root, "rawDataHex", raw_hex);
		free (raw_hex);
	} else {
		cJSON_AddNullToObject (root, "rawDataHex");
	}

	char *json_str = cJSON_PrintUnformatted (root);
	cJSON_Delete (root);

	*out_json = json_str;
	return DC_STATUS_SUCCESS;
}
