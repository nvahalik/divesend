// app/src/components/DiveProfileChart.tsx
import { Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart } from 'recharts';
import type { DiveSample } from '@divesend/core';
import { METERS_TO_FEET, BAR_TO_PSI, formatMinutesSeconds } from '@divesend/core';

interface Props {
  samples: DiveSample[];
}

/** Full depth-over-time chart with an optional tank-pressure overlay. */
export function DiveProfileChart({ samples }: Props) {
  const hasPressure = samples.some((s) => s.tankPressureBar != null);
  const data = samples.map((s) => ({
    timeS: s.timeS,
    depthFt: s.depthM * METERS_TO_FEET,
    pressurePsi: s.tankPressureBar != null ? s.tankPressureBar * BAR_TO_PSI : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="timeS" tickFormatter={formatMinutesSeconds} />
        {/* reversed: depth increases downward on a dive profile */}
        <YAxis yAxisId="depth" reversed label={{ value: 'Depth (ft)', angle: -90, position: 'insideLeft' }} />
        {hasPressure && (
          <YAxis
            yAxisId="pressure"
            orientation="right"
            label={{ value: 'Tank pressure (psi)', angle: 90, position: 'insideRight' }}
          />
        )}
        <Tooltip labelFormatter={(v) => formatMinutesSeconds(Number(v))} formatter={(v) => Math.round(Number(v))} />
        <Area
          yAxisId="depth"
          type="monotone"
          dataKey="depthFt"
          name="Depth (ft)"
          stroke="#2563eb"
          fill="#2563eb"
          fillOpacity={0.15}
          isAnimationActive={false}
        />
        {hasPressure && (
          <Line
            yAxisId="pressure"
            type="monotone"
            dataKey="pressurePsi"
            name="Tank pressure (psi)"
            stroke="#ea580c"
            dot={false}
            isAnimationActive={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}
