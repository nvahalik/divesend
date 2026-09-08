// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getDiagOptIn } from '../engine/diagnostics';
import { DiagnosticsSection } from './DiagnosticsSection';

describe('DiagnosticsSection', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
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
});
