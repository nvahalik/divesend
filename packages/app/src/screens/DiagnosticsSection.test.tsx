// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { __resetDiagOptInCacheForTests, getDiagOptIn, setDiagOptIn } from '../engine/diagnostics';
import { DiagnosticsSection } from './DiagnosticsSection';

describe('DiagnosticsSection', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    localStorage.clear();
    __resetDiagOptInCacheForTests();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const checkbox = () => container.querySelector('input[type="checkbox"]') as HTMLInputElement;

  it('renders opt-in off by default and turns it on', () => {
    act(() => root.render(<DiagnosticsSection />));
    expect(checkbox().checked).toBe(false);

    act(() => checkbox().click());

    expect(checkbox().checked).toBe(true);
    expect(getDiagOptIn()).toBe('granted');
  });

  it('turns it back off', () => {
    act(() => root.render(<DiagnosticsSection />));
    act(() => checkbox().click());
    act(() => checkbox().click());
    expect(getDiagOptIn()).toBe('denied');
  });

  it('reflects a pre-existing granted preference on mount', () => {
    setDiagOptIn('granted');
    act(() => root.render(<DiagnosticsSection />));
    expect(checkbox().checked).toBe(true);
  });

  it('warns when the preference could not be persisted', () => {
    act(() => root.render(<DiagnosticsSection />));
    expect(container.textContent).not.toContain("Couldn't save this preference");

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    act(() => checkbox().click());

    expect(container.textContent).toContain("Couldn't save this preference");
    // ...and it still applies for this session.
    expect(checkbox().checked).toBe(true);
    expect(getDiagOptIn()).toBe('granted');
  });
});
