// app/src/screens/DiagnosticsSection.tsx
import { useState } from 'react';
import { getDiagOptIn, setDiagOptIn } from '../engine/diagnostics';

/**
 * Account-screen control for the opt-in connection telemetry. Default off. When
 * on, each connect attempt sends an anonymous outcome report (browser, dive-
 * computer model, connection log, timings — never dive data) to help debug
 * device-connection problems. A short diagnostic code shown on the Device
 * screen ties a report to a support request.
 */
export function DiagnosticsSection() {
  const [on, setOn] = useState(getDiagOptIn() === 'granted');

  const toggle = () => {
    const next = !on;
    setDiagOptIn(next ? 'granted' : 'denied');
    setOn(next);
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-2 text-sm font-semibold text-slate-700">Diagnostics</div>
      <label className="flex items-start gap-3 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={on}
          onChange={toggle}
          className="mt-0.5 h-4 w-4"
          aria-label="Share anonymous connection diagnostics"
        />
        <span>
          Share anonymous connection diagnostics. Each time you connect a dive computer, DiveSend
          sends an anonymous report — browser, dive-computer model, connection log and timings — so
          connection problems can be diagnosed. <span className="font-medium">No dive data is ever included.</span>
        </span>
      </label>
    </div>
  );
}
