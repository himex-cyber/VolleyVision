import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts';
import { CHART_SERIES, CHART_GRID, CHART_TICK, CHART_TOOLTIP_TEXT } from '../../lib/chartColors';

interface Props {
  stats: {
    kills: number;
    aces: number;
    totalBlocks: number;
    digs: number;
    assists: number;
  };
}

/**
 * Axis label + the raw stat value, matching the mockup's "label 92" spokes.
 * The values are the player's real career totals — this app has no 0-100 skill
 * rating model, so the number shown is the count, not a synthesised score.
 *
 * recharts types the tick renderer's props loosely (x/y widen to string|number),
 * so this takes `any` and narrows locally rather than fighting the signature.
 */
function makeAxisTick(values: Record<string, number>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- recharts' tick renderer props type is too loose to narrow usefully; see comment above
  return function AxisTick(props: any) {
    const metric: string = props?.payload?.value ?? '';
    const textAnchor = props?.textAnchor as 'start' | 'middle' | 'end' | undefined;
    return (
      <text
        x={Number(props?.x ?? 0)}
        y={Number(props?.y ?? 0)}
        textAnchor={textAnchor}
        dominantBaseline="middle"
        fontSize={11}
        fill={CHART_TICK}
      >
        {metric}{' '}
        <tspan fill={CHART_TOOLTIP_TEXT} fontWeight={600}>
          {values[metric]}
        </tspan>
      </text>
    );
  };
}

export default function PlayerRadarChart({ stats }: Props) {
  const data = [
    { metric: 'Kills', value: stats.kills },
    { metric: 'Aces', value: stats.aces },
    { metric: 'Blocks', value: stats.totalBlocks },
    { metric: 'Digs', value: stats.digs },
    { metric: 'Assists', value: stats.assists },
  ];

  const values = Object.fromEntries(data.map((d) => [d.metric, d.value]));

  return (
    <div className="card p-5">
      <h2 className="font-display font-semibold text-lg text-grey-900 mb-4">
        Performance Profile
      </h2>

      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={data} margin={{ top: 12, right: 40, bottom: 12, left: 40 }}>
            <PolarGrid stroke={CHART_GRID} />
            <PolarAngleAxis dataKey="metric" tick={makeAxisTick(values)} />
            <Radar
              dataKey="value"
              stroke={CHART_SERIES[0]}
              strokeWidth={2.4}
              fill={CHART_SERIES[0]}
              fillOpacity={0.18}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
