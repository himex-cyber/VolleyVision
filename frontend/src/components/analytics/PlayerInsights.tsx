import type { PlayerStatLine } from '../../types';

interface Props {
  players: PlayerStatLine[];
}

export default function PlayerInsights({ players }: Props) {
  if (!players.length) return null;

  const topKills = [...players].sort((a, b) => b.kills - a.kills)[0];

  const topAces = [...players].sort((a, b) => b.aces - a.aces)[0];

  const topDigs = [...players].sort((a, b) => b.digs - a.digs)[0];

  const bestHitter = [...players]
    .filter((p) => p.hittingPercentage !== null)
    .sort(
      (a, b) =>
        (b.hittingPercentage ?? 0) -
        (a.hittingPercentage ?? 0)
    )[0];

    const teamKills = players.reduce(
        (sum, p) => sum + p.kills,
            0
        );

    const teamDigs = players.reduce(
        (sum, p) => sum + p.digs,
            0
        );

    const killShare =
        teamKills > 0
        ? Math.round((topKills.kills / teamKills) * 100)
        : 0;

    const digShare =
        teamDigs > 0
            ? Math.round((topDigs.digs / teamDigs) * 100)
            : 0;

    const topBlocks = [...players].sort(
        (a, b) => b.totalBlocks - a.totalBlocks
            )[0];

    const allAroundLeaders = players.filter(
        (p) =>
            p.kills === topKills.kills &&
            p.totalBlocks === topBlocks.totalBlocks
        );          
    
    const cards = [
    {
        title: 'Primary Attacker',
        text: `${topKills.player.firstName} ${topKills.player.lastName} accounts for ${killShare}% of team kills`,
    },

    {
        title: 'Defensive Anchor',
        text: `${topDigs.player.firstName} ${topDigs.player.lastName} accounts for ${digShare}% of team digs`,
    },

    {
        title: 'Top Server',
        text: `${topAces.player.firstName} ${topAces.player.lastName} recorded ${topAces.aces} aces`,
    },

    {
        title: 'Most Efficient Hitter',
        text: bestHitter
        ? `${bestHitter.player.firstName} ${bestHitter.player.lastName} is hitting ${bestHitter.hittingPercentage?.toFixed(3)}`
        : 'No hitting data available',
    },

    {
        title: 'All-Around Impact',
        text:
        allAroundLeaders.length > 0
        ? `${allAroundLeaders[0].player.firstName} ${allAroundLeaders[0].player.lastName} leads the team in both kills and blocks`
        : 'No dominant all-around performer identified',
    },
    ];

  return (
    <div className="card p-4">
      <h2 className="text-lg font-semibold text-grey-900 mb-4">
        Player Insights
      </h2>

      <div className="grid md:grid-cols-2 gap-3">
        {cards.map((card) => (
          <div
            key={card.title}
            className="rounded-lg border border-grey-200 p-3 min-w-0"
          >
            <p className="text-xs text-grey-600">
              {card.title}
            </p>

            <p className="mt-1 text-sm text-grey-900 break-words">
              {card.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}