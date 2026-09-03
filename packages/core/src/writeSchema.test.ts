import { describe, expect, it } from 'vitest';
import { WRITE_SCHEMA_KEYS, buildCreatePayload, buildWritePayload } from './writeSchema';

describe('WRITE_SCHEMA_KEYS', () => {
  it('has exactly 342 keys', () => {
    expect(WRITE_SCHEMA_KEYS).toHaveLength(342);
  });

  it('has no duplicate keys', () => {
    expect(new Set(WRITE_SCHEMA_KEYS).size).toBe(WRITE_SCHEMA_KEYS.length);
  });

  it('includes known keys used elsewhere in this codebase', () => {
    for (const key of [
      'internalPk',
      'odin_user_log_id',
      'odin_user_log_nr',
      'odin_user_log_datetime',
      'odin_user_log_depth_m',
      'odin_user_log_pressure_start_bar',
      'odin_user_log_pressure_start_psi',
      'odin_user_log_dive_sites_id',
      'odin_user_log_var_divetype_id',
      'odin_user_log_var_tanktype_id',
      'odin_user_log_tank_vol_l',
      'odin_user_log_divecomputer_serial_nr',
      'odin_user_log_date',
      'odin_user_log_entry_time',
    ]) {
      expect(WRITE_SCHEMA_KEYS).toContain(key);
    }
  });
});

describe('buildCreatePayload', () => {
  it('produces a full-schema payload with every key present', () => {
    const payload = buildCreatePayload({}, {}, 9);
    expect(Object.keys(payload)).toHaveLength(WRITE_SCHEMA_KEYS.length);
  });

  it('sets odin_user_log_nr and internalPk from diveNr, and forces a create (null id)', () => {
    const payload = buildCreatePayload({}, {}, 9);
    expect(payload.odin_user_log_nr).toBe(9);
    expect(payload.internalPk).toBe(9);
    expect(payload.odin_user_log_id).toBeNull();
  });

  it('carries forward odin_user_log_user_master_id from the account record', () => {
    const payload = buildCreatePayload({ odin_user_log_user_master_id: 555 }, {}, 1);
    expect(payload.odin_user_log_user_master_id).toBe(555);
  });

  it('defaults list-typed fields to empty arrays on create', () => {
    const payload = buildCreatePayload({}, {}, 1);
    expect(payload.odin_user_log_buddy_ids).toEqual([]);
    expect(payload.odin_user_log_animal_ids).toEqual([]);
    expect(payload.odin_user_log_gear).toEqual([]);
  });

  it('applies overrides last, winning over defaults', () => {
    const payload = buildCreatePayload({}, { odin_user_log_depth_m: 3.63 }, 1);
    expect(payload.odin_user_log_depth_m).toBe(3.63);
  });

  it('defaults everything else not supplied by overrides to null', () => {
    const payload = buildCreatePayload({}, {}, 1);
    expect(payload.odin_user_log_dive_sites_id).toBeNull();
    expect(payload.odin_user_log_var_divetype_id).toBeNull();
  });
});

describe('buildWritePayload', () => {
  const read = {
    odin_user_log_id: 26647462,
    odin_user_log_nr: 91,
    odin_user_log_rating: 4,
    odin_user_log_depth_m: 18.3,
    odin_user_log_comment: 'old comment',
  };

  it('produces a full 342-key payload', () => {
    expect(Object.keys(buildWritePayload(read, {}))).toHaveLength(WRITE_SCHEMA_KEYS.length);
  });

  it('borrows the record’s own fields forward and never clobbers an unset one', () => {
    const payload = buildWritePayload(read, { odin_user_log_comment: 'new comment' });
    expect(payload.odin_user_log_comment).toBe('new comment'); // override wins
    expect(payload.odin_user_log_id).toBe(26647462); // preserved (update, not create)
    expect(payload.odin_user_log_rating).toBe(4); // preserved
    expect(payload.odin_user_log_depth_m).toBe(18.3); // preserved
  });

  it('falls back to odin_user_log_nr for internalPk when the record has none', () => {
    expect(buildWritePayload(read, {}).internalPk).toBe(91);
  });

  it('fills unmatched keys from WRITE_ONLY_DEFAULTS, else null', () => {
    const payload = buildWritePayload(read, {});
    expect(payload.needsUpload).toBe(false);
    expect(payload.localBuddyIds).toEqual([]);
    expect(payload.odin_user_log_dive_sites_id).toBeNull();
  });

  it('resolves READ_TO_WRITE_ALIASES (x_ prefixed freediving fields)', () => {
    const payload = buildWritePayload({ ...read, x_odin_user_log_frd_suit: 3 }, {});
    expect(payload.odin_user_log_frd_suit).toBe(3);
  });
});
