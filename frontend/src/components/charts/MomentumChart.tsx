import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { useMomentum } from '../../hooks';
import type { MomentumPoint } from '../../types';
import {
  CHART_SERIES,
  CHART_GRID,
  CHART_TICK,
  CHART_REFERENCE,
  CHART_TOOLTIP_BG,
  CHART_TOOLTIP_TEXT,
} from '../../lib/chartColors';

const US = CHART_SERIES[0];
const THEM = CHART_SERIES[1];
const MAX_POINTS = 200;

interface Row extends MomentumPoint {
  up: number;   // lead when we are ahead, else 0
  down: number; // lead when they are ahead, else 0
}

interface Props {
  matchId: string;
  homeName: string;
  awayName: string;
}

export default function MomentumChart({ matchId, homeName, awayName }: Props) {
  const { data, isLoading, isError } = useMomentum(matchId);
  const [picked, setPicked] = useState<number | null>(null);

  const setNumber = picked ?? data?.sets[0]?.setNumber ?? 1;

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const pts = data.timeline.filter((p) => p.setNumber === setNumber);
    // Keep every Nth point, but always the last so the final lead is drawn.
    const step = Math.ceil(pts.length / MAX_POINTS);
    return pts
      .filter((_, i) => step === 1 || i % step === 0 || i === pts.length - 1)
      .map((p) => ({ ...p, up: Math.max(p.lead, 0), down: Math.min(p.lead, 0) }));
  }, [data, setNumber]);

  if (isLoading) return <div className="card p-4 h-72 bg-grey-100 animate-pulse" aria-busy="true" />;
  if (isError) return <div className="card p-4 text-sm text-grey-600 text-center">Couldn't load momentum.</div>;
  if (!data || data.timeline.length === 0) {
    return <div className="card p-6 text-sm text-grey-600 text-center">No points tracked yet.</div>;
  }

  const set = data.sets.find((s) => s.setNumber === setNumber) ?? data.sets[0];
  const maxLead = Math.max(set?.largestHomeLead ?? 0, set?.largestAwayLead ?? 0, 1);
  const runs = data.significantRuns.filter((r) => r.setNumber === setNumber);
  const setPoints = data.timeline.filter((p) => p.setNumber === setNumber);
  const name = (team: 'home' | 'away') => (team === 'home' ? homeName : awayName);

  function Tip({ active, payload }: TooltipContentProps<ValueType, NameType>) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload as Row;
    return (
      <div
        className="rounded-lg px-3 py-2 text-xs shadow-md"
        style={{ backgroundColor: CHART_TOOLTIP_BG, border: `1px solid ${CHART_GRID}`, color: CHART_TOOLTIP_TEXT }}
      >
        <div style={{ color: CHART_TICK }}>Point {d.pointInSet}</div>
        <div className="font-semibold">{name(d.scorer)} scored</div>
        <div className="font-mono">{homeName} {d.homeScore} – {d.awayScore} {awayName}</div>
        {d.runLength >= 3 && <div>{d.runLength}-point run</div>}
      </div>
    );
  }

  return (
    <div className="card p-4 space-y-4 min-w-0">
      <div role="group" aria-label="Select set" className="flex items-center gap-1 border-b border-grey-200 pb-px overflow-x-auto">
        {data.sets.map((s) => (
          <button
            key={s.setNumber}
            type="button"
            aria-pressed={s.setNumber === setNumber}
            onClick={() => setPicked(s.setNumber)}
            className={clsx(
              'inline-flex items-center min-h-[44px] px-3.5 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              s.setNumber === setNumber
                ? 'border-gold-500 text-navy-700 font-semibold'
                : 'border-transparent text-grey-600 hover:text-navy-700'
            )}
          >
            Set {s.setNumber}
          </button>
        ))}
      </div>

      {set && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="col-span-2 sm:col-span-4 font-mono font-semibold text-grey-900">
            {homeName} {set.homeScore}–{set.awayScore} {awayName}
          </div>
          <Stat label="Longest run" value={`${homeName} ${set.longestHomeRun}`} sub={`${awayName} ${set.longestAwayRun}`} />
          <Stat label="Lead changes" value={String(set.leadChanges)} />
          <Stat label={`Largest lead, ${homeName}`} value={String(set.largestHomeLead)} />
          <Stat label={`Largest lead, ${awayName}`} value={String(set.largestAwayLead)} />
        </div>
      )}

      <div className="h-60 min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 6" vertical={false} />
            <XAxis dataKey="pointInSet" tick={{ fill: CHART_TICK, fontSize: 11 }} axisLine={{ stroke: CHART_GRID }} tickLine={false} />
            <YAxis domain={[-maxLead - 1, maxLead + 1]} allowDecimals={false} tick={{ fill: CHART_TICK, fontSize: 11 }} axisLine={false} tickLine={false} width={34} />
            <Tooltip content={Tip} />
            <ReferenceLine y={0} stroke={CHART_REFERENCE} strokeDasharray="4 2" />
            <Area type="stepAfter" dataKey="up" stroke={US} strokeWidth={2} fill={US} fillOpacity={0.3} dot={false} isAnimationActive={false} />
            <Area type="stepAfter" dataKey="down" stroke={THEM} strokeWidth={2} fill={THEM} fillOpacity={0.3} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-between text-xs text-grey-600">
        <span>Above the line: {homeName} ahead</span>
        <span>Below: {awayName} ahead</span>
      </div>

      {runs.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-grey-900 mb-2">Scoring runs (3+)</h4>
          <ul className="space-y-1 text-sm text-grey-900">
            {runs.map((r) => {
              const at = setPoints.find((p) => p.pointNumber === r.startPoint)?.pointInSet ?? r.startPoint;
              return (
                <li key={`${r.startPoint}-${r.team}`} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: r.team === 'home' ? US : THEM }} />
                  {name(r.team)} {r.length}-0 run from point {at}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-xs text-grey-600">{label}</p>
      <p className="font-mono font-semibold text-grey-900">{value}</p>
      {sub && <p className="font-mono font-semibold text-grey-900">{sub}</p>}
    </div>
  );
}
