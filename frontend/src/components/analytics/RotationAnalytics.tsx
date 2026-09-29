import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import clsx from 'clsx';
import { useRotations } from '../../hooks';
import CsvButton from './CsvButton';
import { safeFileName, toCsv } from '../../lib/csv';
import type { DateRange } from '../../types';
import type { RotationStat } from '../../types';
import {
  CHART_POSITIVE,
  CHART_NEGATIVE,
  CHART_GRID,
  CHART_TICK,
  CHART_REFERENCE,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_TEXT,
} from '../../lib/chartColors';

const pct = (v: number | null) => (v == null ? '–' : `${v}%`);
const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function RotationTooltip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as RotationStat;
  return (
    <div
      className="rounded-lg px-3 py-2 text-xs shadow-md"
      style={{ backgroundColor: CHART_TOOLTIP_BG, border: `1px solid ${CHART_GRID}`, color: CHART_TOOLTIP_TEXT }}
    >
      <div className="font-semibold mb-1">Rotation {d.rotation}</div>
      <div>Won {d.won}, lost {d.lost}</div>
      <div>Net {signed(d.net)}</div>
      <div>Point win % {pct(d.pointWinPct)}</div>
    </div>
  );
}

export default function RotationAnalytics({ scope, id, canTrack = false, range, fileParts }: {
  scope: 'match' | 'team';
  id: string;
  canTrack?: boolean;
  // Team scope only: the match dashboard never filters by date.
  range?: DateRange;
  // CSV file name after 'VolleyVision': team or opponent, then the range or match date.
  fileParts: string[];
}) {
  const { data, isLoading, isError } = useRotations(scope, id, range);

  if (isLoading) return <div className="card p-4 h-48 animate-pulse bg-grey-50" aria-label="Loading rotations" />;
  if (isError || !data) return <p className="text-sm text-error-strong">Couldn't load rotations. Try refreshing the page.</p>;

  const { rotations, insights, coverage } = data;
  const { withServingSide, totalPoints } = coverage;

  if (!rotations.some((r) => r.total > 0)) {
    return (
      <div className="card p-4">
        <h3 className="font-display font-semibold text-grey-900">Rotations</h3>
        <p className="text-sm text-grey-600 text-center py-6">
          No rotation data yet.
          {canTrack && ' Pick a rotation while you track and each point is counted here.'}
        </p>
      </div>
    );
  }

  const maxAbs = Math.max(...rotations.map((r) => Math.abs(r.net)), 1);

  return (
    <div className="card p-4 space-y-4 min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display font-semibold text-grey-900">Rotations</h3>
        {/* Rows are exactly what's on screen; the server already scoped them. */}
        <CsvButton
          filename={safeFileName(['VolleyVision', ...fileParts, 'rotations'])}
          build={() =>
            toCsv(
              [
                { header: 'Rotation', value: (r) => `R${r.rotation}` },
                { header: 'Won', value: (r) => r.won },
                { header: 'Lost', value: (r) => r.lost },
                { header: 'Net', value: (r) => r.net },
                { header: 'Point win %', value: (r) => r.pointWinPct },
                { header: 'Side-out %', value: (r) => r.sideOutPct },
                { header: 'Break-point %', value: (r) => r.breakPointPct },
              ],
              rotations
            )
          }
        />
      </div>

      {insights.best && insights.worst && (
        <p className="text-sm text-grey-600">
          Best rotation by net: <span className="font-semibold text-navy-700">R{insights.best.rotation}</span> ({signed(insights.best.net)}).
          {' '}Worst: <span className="font-semibold text-navy-700">R{insights.worst.rotation}</span> ({signed(insights.worst.net)}).
        </p>
      )}

      <div className="h-48 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rotations} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 6" vertical={false} />
            <XAxis
              dataKey="rotation"
              tickFormatter={(v: number) => `R${v}`}
              tick={{ fill: CHART_TICK, fontSize: 11 }}
              axisLine={{ stroke: CHART_GRID }}
              tickLine={false}
            />
            <YAxis
              domain={[-maxAbs, maxAbs]}
              allowDecimals={false}
              tick={{ fill: CHART_TICK, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={34}
            />
            <Tooltip content={RotationTooltip} />
            <ReferenceLine y={0} stroke={CHART_REFERENCE} />
            <Bar dataKey="net" radius={[4, 4, 0, 0]}>
              {rotations.map((r) => (
                <Cell key={r.rotation} fill={r.net > 0 ? CHART_POSITIVE : r.net < 0 ? CHART_NEGATIVE : CHART_REFERENCE} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="border-b border-grey-200 text-xs text-grey-600">
              <th className="text-left py-2 pr-3 font-medium">Rotation</th>
              <th className="text-right py-2 px-3 font-medium">Won</th>
              <th className="text-right py-2 px-3 font-medium">Lost</th>
              <th className="text-right py-2 px-3 font-medium">Net</th>
              <th className="text-right py-2 px-3 font-medium">Point win %</th>
              <th className="text-right py-2 px-3 font-medium">Side-out %</th>
              <th className="text-right py-2 pl-3 font-medium">Break-point %</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-grey-200">
            {rotations.map((r) => (
              <tr key={r.rotation} className={clsx(r.total === 0 && 'text-grey-400')}>
                <td className="py-2 pr-3 font-semibold text-grey-900">R{r.rotation}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.won}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.lost}</td>
                <td
                  className={clsx(
                    'py-2 px-3 text-right tabular-nums font-semibold',
                    r.net > 0 && 'text-success-strong',
                    r.net < 0 && 'text-error-strong'
                  )}
                >
                  {signed(r.net)}
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{pct(r.pointWinPct)}</td>
                <td className="py-2 px-3 text-right tabular-nums">{pct(r.sideOutPct)}</td>
                <td className="py-2 pl-3 text-right tabular-nums">{pct(r.breakPointPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPoints > 0 && withServingSide === 0 && (
        <p className="text-xs text-warning-strong font-medium">
          Side-out needs the serving side.
          {canTrack && ' Set Serving: Us/Them while you track.'}
        </p>
      )}
      {withServingSide > 0 && withServingSide < totalPoints && (
        <p className="text-xs text-grey-600">
          Side-out and break-point use {withServingSide} of {totalPoints} points, the ones with a serving side.
        </p>
      )}
    </div>
  );
}
