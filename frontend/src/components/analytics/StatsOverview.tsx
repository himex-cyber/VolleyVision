import { useNavigate } from 'react-router-dom';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import type { PlayerStatLine, StatLine } from '../../types';
import { POSITION_FULL_LABELS } from '../../types';
import { CHART_SERIES, CHART_NEGATIVE } from '../../lib/chartColors';

function percentage(value: number | null) {
  if (value === null) return '-';

  // Volleyball convention:
  // 0.250 -> .250
  // 1.000 -> 1.000
  // -0.125 -> -.125

  if (Math.abs(value) >= 1) {
    return value.toFixed(3);
  }

  const sign = value < 0 ? '-' : '';
  return `${sign}.${Math.abs(value).toFixed(3).split('.')[1]}`;
}

function decimal(value: number | null, places = 2) {
  return value === null ? '-' : value.toFixed(places);
}

/**
 * Per-match history for a stat, oldest first, keyed by the card label it backs.
 * Optional: the coach/team/match dashboards have no per-match history to pass,
 * and those cards simply render without a sparkline or trend badge rather than
 * showing an invented one.
 */
export type StatTrends = Record<string, (number | null)[]>;

const MIN_POINTS_FOR_SPARKLINE = 2;
const MIN_POINTS_FOR_DELTA = 4; // 2 per half — anything less isn't a trend

/**
 * Relative change between the mean of the earlier half of the season and the
 * mean of the recent half. Null whenever there isn't enough real history to
 * compare against, or the earlier baseline is zero/negative (a % change off a
 * zero baseline is meaningless).
 */
function delta(series: (number | null)[] | undefined): number | null {
  if (!series) return null;
  const points = series.filter((v): v is number => v !== null);
  if (points.length < MIN_POINTS_FOR_DELTA) return null;

  const split = Math.floor(points.length / 2);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const earlier = mean(points.slice(0, split));
  const recent = mean(points.slice(split));

  if (earlier <= 0) return null;
  return (recent - earlier) / earlier;
}

function Sparkline({ series, positive }: { series: (number | null)[]; positive: boolean }) {
  const data = series.map((value, i) => ({ i, value }));
  return (
    <div className="w-16 h-7 shrink-0" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 3, bottom: 3, left: 0, right: 0 }}>
          <Line
            type="monotone"
            dataKey="value"
            stroke={positive ? CHART_SERIES[0] : CHART_NEGATIVE}
            strokeWidth={2.2}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendBadge({ value }: { value: number }) {
  const up = value >= 0;
  return (
    <span
      title="Recent matches vs. earlier matches this season"
      className={`badge ${up ? 'bg-success/15 text-success' : 'bg-error/15 text-error'}`}
    >
      {up ? '▲' : '▼'} {Math.abs(Math.round(value * 100))}%
    </span>
  );
}

export function StatsCards({ stats, trends }: { stats: StatLine; trends?: StatTrends }) {
  const cards = [
    { label: 'Kills', value: stats.kills, detail: `${stats.attackAttempts} attempts` },
    { label: 'Hitting %', value: percentage(stats.hittingPercentage), detail: `${stats.attackErrors} errors` },
    { label: 'Aces', value: stats.aces, detail: `${stats.serviceErrors} service errors` },
    { label: 'Passing', value: decimal(stats.passingRating), detail: `${stats.passAttempts} receptions` },
    { label: 'Blocks', value: decimal(stats.totalBlocks, 1), detail: `${stats.soloBlocks} solo, ${stats.blockAssists} assists` },
    { label: 'Digs', value: stats.digs, detail: `${stats.digErrors} errors` },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
      {cards.map((card) => {
        const series = trends?.[card.label];
        const change = delta(series);
        const hasSparkline = (series?.filter((v) => v !== null).length ?? 0) >= MIN_POINTS_FOR_SPARKLINE;

        return (
          <div key={card.label} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-grey-600">
                {card.label}
              </p>
              {change !== null && <TrendBadge value={change} />}
            </div>

            <div className="flex items-end justify-between gap-2 mt-2">
              <p className="tabular-nums text-2xl font-bold text-grey-900 leading-none">{card.value}</p>
              {hasSparkline && series && (
                <Sparkline series={series} positive={change === null || change >= 0} />
              )}
            </div>

            <p className="text-xs text-grey-600 mt-2">{card.detail}</p>
          </div>
        );
      })}
    </div>
  );
}

export function PlayerStatsTable({
  rows,
  matchId,
  teamId,
  canOpen,
}: {
  rows: PlayerStatLine[];
  matchId?: string;
  teamId: string;
  // Whether the viewer may drill into this player's individual dashboard —
  // the analytics endpoint 403s for anyone but staff and the player, so a row
  // that can't be opened is rendered without click affordances instead.
  canOpen: (playerId: string) => boolean;
}) {
  const navigate = useNavigate();

  function goToPlayer(playerId: string) {
    const params = matchId ? `matchId=${matchId}&teamId=${teamId}` : `teamId=${teamId}`;
    navigate(`/players/${playerId}/dashboard?${params}`);
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="bg-grey-50 text-grey-600 text-xs border-b border-grey-200">
          <tr>
            <th className="text-left px-4 py-3">Player</th>
            <th className="text-center px-3 py-3">K</th>
            <th className="text-center px-3 py-3">E</th>
            <th className="text-center px-3 py-3">TA</th>
            <th className="text-center px-3 py-3">Hit %</th>
            <th className="text-center px-3 py-3">Ace</th>
            <th className="text-center px-3 py-3">SE</th>
            <th className="text-center px-3 py-3">Pass</th>
            <th className="text-center px-3 py-3">Blk</th>
            <th className="text-center px-3 py-3">Dig</th>
            <th className="text-center px-3 py-3">Ast</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-grey-200">
          {rows.map((row) => {
            const canOpenRow = canOpen(row.player.id);
            return (
            <tr
              key={row.player.id}
              tabIndex={canOpenRow ? 0 : undefined}
              onClick={canOpenRow ? () => goToPlayer(row.player.id) : undefined}
              onKeyDown={canOpenRow ? (e) => { if (e.key === 'Enter') goToPlayer(row.player.id); } : undefined}
              className={`transition-colors ${canOpenRow ? 'hover:bg-grey-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500' : ''}`}
            >
              <td className="px-4 py-4">
                <div className="flex items-center gap-3">
                  {/* Placeholder avatar — jersey number in a circle. Structured
                      so a real photoUrl can drop an <img> in here later without
                      restructuring the row (Player has no photo field yet). */}
                  <div className="w-12 h-12 rounded-full bg-navy-100 text-navy-700 flex items-center justify-center shrink-0">
                    <span className="tabular-nums font-bold text-base">{row.player.jerseyNumber}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="font-medium text-grey-900">
                      {row.player.firstName} {row.player.lastName}
                    </span>
                    <span className="text-xs text-grey-400 ml-2">{POSITION_FULL_LABELS[row.player.position]}</span>
                  </div>
                </div>
              </td>
              <td className="stat-cell">{row.kills}</td>
              <td className="stat-cell">{row.attackErrors}</td>
              <td className="stat-cell">{row.attackAttempts}</td>
              <td className="stat-cell font-semibold text-navy-700">{percentage(row.hittingPercentage)}</td>
              <td className="stat-cell">{row.aces}</td>
              <td className="stat-cell">{row.serviceErrors}</td>
              <td className="stat-cell">{decimal(row.passingRating)}</td>
              <td className="stat-cell">{decimal(row.totalBlocks, 1)}</td>
              <td className="stat-cell">{row.digs}</td>
              <td className="stat-cell">{row.assists}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="text-grey-600 text-sm p-5">No player statistics yet.</p>}
    </div>
  );
}
