import { useState } from 'react';
import type { CSSProperties } from 'react';
import clsx from 'clsx';
import type { ZoneMap, ZoneAttack, ZoneServe, ZonePass, ZoneDefence } from '../../types';
import { CHART_SERIES, CHART_POSITIVE, CHART_NEGATIVE } from '../../lib/chartColors';

// Standard volleyball zone layout, net at the top (see CourtZoneSelector.tsx):
//   4 | 3 | 2   ← front row
//   5 | 6 | 1   ← back row
const ZONE_LAYOUT = ['4', '3', '2', '5', '6', '1'] as const;
const ZONES = ['1', '2', '3', '4', '5', '6'] as const;

type Category = 'attack' | 'serve' | 'pass' | 'defence';

const CATEGORIES: { key: Category; label: string; color: string }[] = [
  { key: 'attack', label: 'Attack', color: CHART_NEGATIVE },
  { key: 'serve', label: 'Serve', color: CHART_SERIES[2] },
  { key: 'pass', label: 'Pass', color: CHART_SERIES[3] },
  { key: 'defence', label: 'Defence', color: CHART_POSITIVE },
];

// The count each category is "busiest" by — drives colour intensity relative
// to that category's own zones, not comparable across categories.
function zoneVolume(zone: string, data: ZoneMap, category: Category): number {
  switch (category) {
    case 'attack': return data.attack[zone]?.attempts ?? 0;
    case 'serve': return data.serve[zone]?.attempts ?? 0;
    case 'pass': return data.pass[zone]?.attempts ?? 0;
    case 'defence': return data.defence[zone]?.total ?? 0;
  }
}

// Volleyball-style hitting percentage: ".250", "-.100" — no leading zero.
function formatHittingPct(pct: number | null): string {
  if (pct == null) return '—';
  const digits = Math.abs(pct).toFixed(3).slice(1);
  return pct < 0 ? `-${digits}` : digits;
}

function formatPercent(frac: number | null): string {
  return frac == null ? '—' : `${Math.round(frac * 100)}%`;
}

function formatRating(rating: number | null): string {
  return rating == null ? '—' : rating.toFixed(2);
}

const INTENSITY_MIN = 8;
const INTENSITY_CAP = 55; // keeps grey-900 cell text readable even at the busiest zone

function cellStyle(volume: number, maxVolume: number, color: string): CSSProperties {
  if (volume === 0) return {};
  const pct = INTENSITY_MIN + (volume / maxVolume) * (INTENSITY_CAP - INTENSITY_MIN);
  return { backgroundColor: `color-mix(in srgb, ${color} ${pct}%, white)` };
}

function ZoneCell({ zone, data, category, color, maxVolume }: {
  zone: string;
  data: ZoneMap;
  category: Category;
  color: string;
  maxVolume: number;
}) {
  const volume = zoneVolume(zone, data, category);
  let main: number;
  let sub: string;
  let badge: string;
  let label: string;

  if (category === 'attack') {
    const a = data.attack[zone] as ZoneAttack | undefined;
    const kills = a?.kills ?? 0;
    const attempts = a?.attempts ?? 0;
    badge = formatHittingPct(a?.hittingPct ?? null);
    main = kills;
    sub = `${attempts} att`;
    label = `Zone ${zone}: ${kills} kills from ${attempts} attacks, hitting ${badge}`;
  } else if (category === 'serve') {
    const s = data.serve[zone] as ZoneServe | undefined;
    const aces = s?.aces ?? 0;
    const attempts = s?.attempts ?? 0;
    badge = formatPercent(s?.efficiency ?? null);
    main = aces;
    sub = `${attempts} srv`;
    label = `Zone ${zone}: ${aces} aces from ${attempts} serves, efficiency ${badge}`;
  } else if (category === 'pass') {
    const p = data.pass[zone] as ZonePass | undefined;
    const attempts = p?.attempts ?? 0;
    badge = formatRating(p?.rating ?? null);
    main = attempts;
    sub = 'passes';
    label = `Zone ${zone}: ${attempts} passes, rating ${badge}`;
  } else {
    const d = data.defence[zone] as ZoneDefence | undefined;
    const digs = d?.digs ?? 0;
    const blocks = (d?.soloBlocks ?? 0) + (d?.blockAssists ?? 0);
    badge = '';
    main = d?.total ?? 0;
    sub = `${digs}D / ${blocks}B`;
    label = `Zone ${zone}: ${digs} digs and ${blocks} blocks`;
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={clsx(
        'relative aspect-square flex flex-col items-center justify-center border border-grey-200 p-1',
        volume === 0 && 'bg-grey-50'
      )}
      style={cellStyle(volume, maxVolume, color)}
    >
      <span className="absolute top-1 left-1.5 text-[10px] font-mono font-bold text-grey-600">{zone}</span>
      <span className="font-mono font-bold text-grey-900 text-sm leading-tight">{main}</span>
      <span className="font-mono text-grey-600 text-[10px] leading-tight">{sub}</span>
      {badge && (
        <span
          className="mt-0.5 text-[10px] font-semibold px-1.5 rounded text-grey-900 bg-white/70"
        >
          {badge}
        </span>
      )}
    </div>
  );
}

interface Props {
  data: ZoneMap;
  title?: string;
  defaultCategory?: Category;
  /** Whether the viewer tracks matches here: only they can act on the empty-state advice. */
  canTrack?: boolean;
}

export default function CourtHeatMap({ data, title, defaultCategory = 'attack', canTrack = false }: Props) {
  const [category, setCategory] = useState<Category>(defaultCategory);
  const cat = CATEGORIES.find((c) => c.key === category)!;
  const { tagged, total } = data.coverage;
  const lowCoverage = total > 0 && tagged / total < 0.3;
  const maxVolume = Math.max(...ZONES.map((z) => zoneVolume(z, data, category)), 1);

  return (
    <div className="card p-4 space-y-4">
      {title && <h3 className="font-semibold text-grey-900">{title}</h3>}

      <div role="tablist" className="flex items-end border-b border-grey-200 pb-px overflow-x-auto">
        <div className="flex items-center gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={category === c.key}
              onClick={() => setCategory(c.key)}
              className={clsx(
                'inline-flex items-center min-h-[44px] px-3.5 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                category === c.key
                  ? 'border-gold-500 text-navy-700 font-semibold'
                  : 'border-transparent text-grey-600 hover:text-navy-700'
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {tagged === 0 ? (
        <p className="text-sm text-grey-600 text-center py-6">
          {canTrack
            ? 'No zones tagged yet. Pick a zone when you record an action and this map fills in.'
            : 'No zones tagged yet. This map fills in once your coaches pick zones while tracking.'}
        </p>
      ) : (
        <div className="space-y-2 max-w-sm mx-auto">
          <div className="flex items-center justify-center border-b-2 border-gold-500 py-1">
            <span className="text-[9px] font-bold tracking-widest text-navy-700">NET</span>
          </div>
          <div className="grid grid-cols-3 gap-1 border border-grey-200 rounded-lg overflow-hidden">
            {ZONE_LAYOUT.map((zone) => (
              <ZoneCell key={zone} zone={zone} data={data} category={category} color={cat.color} maxVolume={maxVolume} />
            ))}
          </div>
          <p className={clsx('text-xs text-center', lowCoverage ? 'text-warning-strong font-medium' : 'text-grey-600')}>
            {/* Always the full ratio: a map built from 5 of 80 attacks must say so. */}
            Based on {tagged} of {total} actions ({Math.round((tagged / total) * 100)}%) that have a zone.
            {lowCoverage && (canTrack
              ? ' Most actions have no zone yet, so pick one while tracking to fill this in.'
              : ' Most actions have no zone yet, so treat this as a partial picture.')}
          </p>
        </div>
      )}
    </div>
  );
}
