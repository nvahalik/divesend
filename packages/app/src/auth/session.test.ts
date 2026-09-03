// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUEST_MODE_STORAGE_KEY, enableGuestMode, resolveSession } from './session';
import * as authClient from './authClient';
import * as guestSsiSession from '../ssi/guestSsiSession';

afterEach(() => {
  localStorage.removeItem(GUEST_MODE_STORAGE_KEY);
  vi.restoreAllMocks();
});

describe('resolveSession', () => {
  it('returns an AccountUser when me() resolves a user, ignoring the guest flag', async () => {
    vi.spyOn(authClient, 'me').mockResolvedValue({ email: 'a@b.com', ssiLinked: true, ssiEmail: 'd@ssi.example' });
    enableGuestMode();

    expect(await resolveSession()).toEqual({
      kind: 'account',
      email: 'a@b.com',
      ssiLinked: true,
      ssiEmail: 'd@ssi.example',
    });
  });

  it('clears a leftover guest SSI session when resolving as an account', async () => {
    vi.spyOn(authClient, 'me').mockResolvedValue({ email: 'a@b.com', ssiLinked: false, ssiEmail: null });
    const clear = vi.spyOn(guestSsiSession, 'clearGuestSsiSession');
    vi.spyOn(guestSsiSession, 'getGuestSsiSession').mockReturnValue({ token: 't', ssiEmail: 'd@ssi.example' });

    await resolveSession();

    expect(clear).toHaveBeenCalled();
  });

  it('returns a GuestUser when me() is null and the guest flag is set', async () => {
    vi.spyOn(authClient, 'me').mockResolvedValue(null);
    vi.spyOn(guestSsiSession, 'getGuestSsiSession').mockReturnValue({ token: 't', ssiEmail: 'd@ssi.example' });
    enableGuestMode();

    expect(await resolveSession()).toEqual({ kind: 'guest', ssiLinked: true, ssiEmail: 'd@ssi.example' });
  });

  it('GuestUser has ssiLinked false when no guest SSI session exists', async () => {
    vi.spyOn(authClient, 'me').mockResolvedValue(null);
    vi.spyOn(guestSsiSession, 'getGuestSsiSession').mockReturnValue(null);
    enableGuestMode();

    expect(await resolveSession()).toEqual({ kind: 'guest', ssiLinked: false, ssiEmail: null });
  });

  it('returns null when me() is null and no guest flag is set', async () => {
    vi.spyOn(authClient, 'me').mockResolvedValue(null);
    expect(await resolveSession()).toBeNull();
  });
});
