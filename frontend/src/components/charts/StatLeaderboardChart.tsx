import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { DateRange, PlayerStatLine } from '../../types';
import { rangeQuery } from '../../lib/dateRange';
import { CHART_SERIES, CHART_TICK, CHART_TOOLTIP_BG, CHART_TOOLTIP_TEXT, CHART_GRID } from '../../lib/chartColors';
import { useChartWidth } from '../../lib/printing';

interface Props {
  title: string;
  players: PlayerStatLine[];
  metric: 'kills' | 'aces' | 'digs' | 'totalBlocks';
  teamId: string;
  // Whether the viewer may drill into a bar's player dashboard — the analytics
  // endpoint 403s for anyone but this team's staff and the player themself.
  canOpen: (playerId: string) => boolean;
  /** Staff can open every bar, so the hint and pointer show for them only. */
  canOpenAll: boolean;
  /** Carried to the player page so it shows the same dates. */
  range?: DateRange;
}

export default function StatLeaderboardChart({
  title,
  players,
  metric,
  teamId,
  canOpen,
  canOpenAll,
  range,
}: Props) {
  const chartWidth = useChartWidth(); // fixed while printing (8.7)
  const navigate = useNavigate();
  const data = [...players]
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, 5)
    .map((player) => ({
    id: player.player.id,
      name: `${player.player.firstName} ${player.player.lastName.charAt(0)}`,
      value: player[metric],
    }));

  return (
    <div className="card p-4 min-w-0">
      <h2 className="font-semibold text-grey-900 mb-3">
        {title}
      </h2>
      {canOpenAll && (
        <p className="text-xs text-grey-600 mb-2">
          Click a player bar to view details
        </p>
      )}

      <div className="h-64 min-w-0">
        <ResponsiveContainer width={chartWidth} height="100%">
          <BarChart data={data}>
            <XAxis
              dataKey="name"
              // Every bar keeps its label (recharts would otherwise drop some on
              // a narrow card), so long names are shortened instead: at 360px
              // five bars leave ~49px per label, 7 characters at 11px. The
              // tooltip still shows the full name.
              tick={{ fill: CHART_TICK, fontSize: 11 }}
              interval={0}
              tickFormatter={(name: string) => (name.length > 7 ? `${name.slice(0, 6)}…` : name)}
            />
            <YAxis
              tick={{ fill: CHART_TICK, fontSize: 11 }}
              width={32}
            />
            <Tooltip
              formatter={(value) => [value, title]}
              contentStyle={{
                backgroundColor: CHART_TOOLTIP_BG,
                border: `1px solid ${CHART_GRID}`,
                borderRadius: '8px',
                color: CHART_TOOLTIP_TEXT,
              }}
              labelStyle={{
                color: CHART_TOOLTIP_TEXT,
                fontWeight: 'bold',
              }}
            />
            <Bar
              dataKey="value"
              fill={CHART_SERIES[0]}
              radius={[4, 4, 0, 0]}
              cursor={canOpenAll ? 'pointer' : 'default'}
              onClick={(data) => {
                if (data.id && canOpen(data.id)) navigate(`/players/${data.id}/dashboard?teamId=${teamId}${rangeQuery(range)}`);
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}