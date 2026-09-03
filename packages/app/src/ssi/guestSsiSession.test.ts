// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  GUEST_SSI_STORAGE_KEY,
  clearGuestSsiSession,
  getGuestSsiSession,
  rememberGuestSsiPassword,
  setGuestSsiSession,
  takeGuestSsiPassword,
} from './guestSsiSession';

afterEach(() => {
  localStorage.removeItem(GUEST_SSI_STORAGE_KEY);
  takeGuestSsiPassword(); // drain the in-memory holder between tests
});

describe('guestSsiSession storage', () => {
  it('returns null when nothing is stored', () => {
    expect(getGuestSsiSession()).toBeNull();
  });

  it('round-trips token and email, and stores no other fields', () => {
    setGuestSsiSession({ token: 'tok-123', ssiEmail: 'diver@ssi.example' });
    expect(getGuestSsiSession()).toEqual({ token: 'tok-123', ssiEmail: 'diver@ssi.example' });

    const raw = JSON.parse(localStorage.getItem(GUEST_SSI_STORAGE_KEY) as string);
    expect(Object.keys(raw).sort()).toEqual(['ssiEmail', 'token']);
  });

  it('clear removes the stored session', () => {
    setGuestSsiSession({ token: 'tok-123', ssiEmail: 'diver@ssi.example' });
    clearGuestSsiSession();
    expect(getGuestSsiSession()).toBeNull();
  });

  it('returns null for a malformed stored value', () => {
    localStorage.setItem(GUEST_SSI_STORAGE_KEY, 'not json');
    expect(getGuestSsiSession()).toBeNull();
  });

  it('returns null when the stored object is missing a field', () => {
    localStorage.setItem(GUEST_SSI_STORAGE_KEY, JSON.stringify({ token: 'tok-123' }));
    expect(getGuestSsiSession()).toBeNull();
  });
});

describe('guestSsiSession in-memory password holder', () => {
  it('take returns the remembered password once, then null', () => {
    rememberGuestSsiPassword('ssi-pass');
    expect(takeGuestSsiPassword()).toBe('ssi-pass');
    expect(takeGuestSsiPassword()).toBeNull();
  });

  it('take returns null when nothing was remembered', () => {
    expect(takeGuestSsiPassword()).toBeNull();
  });
});
