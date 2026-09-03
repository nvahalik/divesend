// Persisted-credential store: `authFilePath` / `loadAuth` / `saveAuth` /
// `clearAuth`. Every test points `$XDG_CONFIG_HOME` at a throwaway temp dir so
// nothing touches the real `~/.config`.

import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  chmodSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authFilePath, loadAuth, saveAuth, clearAuth } from '../src/auth.js';

let tmp: string;
let prevXdg: string | undefined;

function writeRaw(contents: string): void {
  mkdirSync(dirname(authFilePath()), { recursive: true });
  writeFileSync(authFilePath(), contents);
}

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  tmp = mkdtempSync(join(tmpdir(), 'auth-'));
  process.env.XDG_CONFIG_HOME = tmp;
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true });
});

describe('auth store', () => {
  it('saveAuth then loadAuth round-trips the credentials', () => {
    saveAuth({ email: 'a@b.c', password: 'pw' });
    expect(loadAuth()).toEqual({ email: 'a@b.c', password: 'pw' });
  });

  it('writes the auth file with mode 0600', () => {
    saveAuth({ email: 'a@b.c', password: 'pw' });
    expect(statSync(authFilePath()).mode & 0o777).toBe(0o600);
  });

  it('re-tightens perms on an existing loose file', () => {
    writeRaw('{}');
    chmodSync(authFilePath(), 0o644);
    saveAuth({ email: 'a@b.c', password: 'pw' });
    expect(statSync(authFilePath()).mode & 0o777).toBe(0o600);
  });

  it('loadAuth returns null when the file is absent', () => {
    expect(loadAuth()).toBeNull();
  });

  it('loadAuth returns null on a parse error', () => {
    writeRaw('{ not json');
    expect(loadAuth()).toBeNull();
  });

  it('loadAuth returns null when a field is missing', () => {
    writeRaw('{"email":"x"}');
    expect(loadAuth()).toBeNull();
  });

  it('clearAuth twice does not throw', () => {
    saveAuth({ email: 'a@b.c', password: 'pw' });
    expect(() => {
      clearAuth();
      clearAuth();
    }).not.toThrow();
    expect(loadAuth()).toBeNull();
  });
});
