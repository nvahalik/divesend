// app/src/components/DiveProfileSparkline.tsx
import { AreaChart, Area, YAxis, ResponsiveContainer } from 'recharts';
import type { DiveSample } from '@divesend/core';

const MAX_POINTS = 60;

function downsample(samples: DiveSample[]): DiveSample[] {
  if (samples.length <= MAX_POINTS) return samples;
  // Dividing by MAX_POINTS - 1 (not MAX_POINTS) so index MAX_POINTS - 1 maps
  // to samples.length - 1 -- otherwise the last ~len/MAX_POINTS samples
  // (the ascent/surface-approach, the most recognizable part of a dive
  // profile) never get picked, since the highest index reached would fall
  // short of the true final sample.
  const stride = (samples.length - 1) / (MAX_POINTS - 1);
  return Array.from({ length: MAX_POINTS }, (_, i) => samples[Math.round(i * stride)]);
}

interface Props {
  samples: DiveSample[];
}

/** Minimal depth-over-time chart for a dive list row -- no axes/labels, just the shape. */
export function DiveProfileSparkline({ samples }: Props) {
  const data = downsample(samples).map((s) => ({ timeS: s.timeS, depthM: s.depthM }));

  return (
    <ResponsiveContainer width={100} height={44}>
      <AreaChart data={data}>
        {/* reversed: depth increases downward on a dive profile */}
        <YAxis reversed hide domain={[0, 'dataMax']} />
        <Area
          type="monotone"
          dataKey="depthM"
          stroke="#2563eb"
          fill="#2563eb"
          fillOpacity={0.15}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
