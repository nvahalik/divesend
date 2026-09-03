// `divesend login` / `logout` -- the flag path only (the interactive
// hidden-prompt path is not driven here). `authenticate` is mocked so no
// network call happens, and `$XDG_CONFIG_HOME` points at a temp dir.

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/ssi/client.js', () => ({
  authenticate: vi.fn(),
}));

import { authenticate } from '../../src/ssi/client.js';
import { login, logout } from '../../src/commands/login.js';
import { CliError } from '../../src/io.js';
import { authFilePath, saveAuth } from '../../src/auth.js';

const authMock = authenticate as unknown as ReturnType<typeof vi.fn>;

let tmp: string;
let prevXdg: string | undefined;
let stderrSpy: ReturnType<typeof vi.spyOn>;

const stderrText = () => stderrSpy.mock.calls.map((c) => String(c[0])).join('');

beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  tmp = mkdtempSync(join(tmpdir(), 'login-'));
  process.env.XDG_CONFIG_HOME = tmp;
  authMock.mockReset();
  authMock.mockResolvedValue('test-token');
  stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  rmSync(tmp, { recursive: true, force: true });
  stderrSpy.mockRestore();
});

describe('login (flags)', () => {
  it('verifies with authenticate, writes the file, reports the email', async () => {
    await login({ email: 'a@b.c', password: 'pw' });

    expect(authMock).toHaveBeenCalledWith('a@b.c', 'pw');
    expect(existsSync(authFilePath())).toBe(true);
    expect(stderrText()).toContain('Logged in as a@b.c.');
  });

  it('does not write the file when authenticate rejects', async () => {
    authMock.mockRejectedValue(new Error('Authentication failed: bad login'));

    await expect(login({ email: 'a@b.c', password: 'bad' })).rejects.toThrow(
      'Authentication failed',
    );

    expect(existsSync(authFilePath())).toBe(false);
  });
});

describe('login --status', () => {
  it('prints the stored email when logged in', async () => {
    saveAuth({ email: 'stored@example.com', password: 'pw' });

    await login({ status: true });

    expect(stderrText()).toContain('Logged in as stored@example.com.');
    expect(stderrText()).not.toContain('pw');
  });

  it('fails when not logged in', async () => {
    await expect(login({ status: true })).rejects.toBeInstanceOf(CliError);
    await expect(login({ status: true })).rejects.toThrow('Not logged in.');
  });
});

describe('logout', () => {
  it('removes the file and never throws', async () => {
    saveAuth({ email: 'a@b.c', password: 'pw' });

    logout();

    expect(existsSync(authFilePath())).toBe(false);
    expect(stderrText()).toContain('Logged out.');
  });

  it('does not throw when there is nothing to remove', () => {
    expect(() => logout()).not.toThrow();
    expect(stderrText()).toContain('Logged out.');
  });
});
