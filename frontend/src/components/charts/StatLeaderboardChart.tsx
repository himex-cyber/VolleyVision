import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';
import type { PlayerStatLine } from '../../types';
import { CHART_SERIES, CHART_TICK, CHART_TOOLTIP_BG, CHART_TOOLTIP_TEXT, CHART_GRID } from '../../lib/chartColors';

interface Props {
  title: string;
  players: PlayerStatLine[];
  metric: 'kills' | 'aces' | 'digs' | 'totalBlocks';
  teamId: string;
  // Whether the viewer may drill into a bar's player dashboard — the analytics
  // endpoint 403s for anyone but this team's tracking staff, so bars render
  // without click affordances instead of navigating into an error page.
  canOpen: boolean;
}

export default function StatLeaderboardChart({
  title,
  players,
  metric,
  teamId,
  canOpen,
}: Props) {
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
    <div className="card p-4">
      <h2 className="font-semibold text-chalk-100 mb-3">
        {title}
      </h2>
      {canOpen && (
        <p className="text-xs text-grey-500 mb-2">
          Click a player bar to view details
        </p>
      )}

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis
              dataKey="name"
              tick={{ fill: CHART_TICK, fontSize: 12 }}
            />
            <YAxis
              tick={{ fill: CHART_TICK, fontSize: 12 }}
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
              cursor={canOpen ? 'pointer' : 'default'}
              onClick={canOpen ? (data) => {
                navigate(`/players/${data.id}/dashboard?teamId=${teamId}`);
              } : undefined}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}