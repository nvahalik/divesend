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
import { run } from '../../src/commands/login.js';
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
    await run('login', ['--email', 'a@b.c', '--password', 'pw']);

    expect(authMock).toHaveBeenCalledWith('a@b.c', 'pw');
    expect(existsSync(authFilePath())).toBe(true);
    expect(stderrText()).toContain('logged in as a@b.c');
  });

  it('does not write the file when authenticate rejects', async () => {
    authMock.mockRejectedValue(new Error('Authentication failed: bad login'));

    await expect(
      run('login', ['--email', 'a@b.c', '--password', 'bad']),
    ).rejects.toThrow('Authentication failed');

    expect(existsSync(authFilePath())).toBe(false);
  });
});

describe('login --status', () => {
  it('prints the stored email when logged in', async () => {
    saveAuth({ email: 'stored@example.com', password: 'pw' });

    await run('login', ['--status']);

    expect(stderrText()).toContain('logged in as stored@example.com');
    expect(stderrText()).not.toContain('pw');
  });

  it('exits 1 when not logged in', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);

    await expect(run('login', ['--status'])).rejects.toThrow('exit');
    expect(stderrText()).toContain('not logged in');

    exit.mockRestore();
  });
});

describe('logout', () => {
  it('removes the file and never throws', async () => {
    saveAuth({ email: 'a@b.c', password: 'pw' });

    await run('logout', []);

    expect(existsSync(authFilePath())).toBe(false);
    expect(stderrText()).toContain('logged out');
  });

  it('does not throw when there is nothing to remove', async () => {
    await expect(run('logout', [])).resolves.toBeUndefined();
    expect(stderrText()).toContain('logged out');
  });
});
