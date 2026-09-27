import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { CHART_SERIES, CHART_GRID, CHART_TICK, CHART_TOOLTIP_BG, CHART_TOOLTIP_TEXT } from '../../lib/chartColors';

interface Props {
  title: string;
  // Callers pass differently-shaped rows (match perf stats, per-stat trend
  // rows) with no shared index signature; dataKey picks whichever field to
  // plot dynamically, so a precise type here would need widening every
  // caller's shape instead.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any[];
  dataKey: string;
}

export default function TeamTrendChart({ title, data, dataKey }: Props) {
  // One gradient per chart — ids must be unique or the last one on the page wins.
  const gradientId = `trend-fill-${dataKey}`;

  return (
    <div className="card p-4">
      <h3 className="font-display font-semibold text-grey-900 mb-3">{title}</h3>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_SERIES[0]} stopOpacity={0.28} />
                <stop offset="100%" stopColor={CHART_SERIES[0]} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 6" vertical={false} />
            <XAxis
              dataKey="opponent"
              tick={{ fill: CHART_TICK, fontSize: 11 }}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: CHART_TICK, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={34}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: CHART_TOOLTIP_BG,
                border: `1px solid ${CHART_GRID}`,
                borderRadius: '8px',
                color: CHART_TOOLTIP_TEXT,
              }}
              labelStyle={{ color: CHART_TICK }}
            />

            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={CHART_SERIES[0]}
              strokeWidth={3}
              fill={`url(#${gradientId})`}
              dot={{ r: 3, fill: CHART_TOOLTIP_BG, stroke: CHART_SERIES[0], strokeWidth: 2 }}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
