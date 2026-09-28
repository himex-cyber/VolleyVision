import type { TeamInsight } from '../../types';

interface Props {
  insights: TeamInsight[];
}

export default function CoachInsights({
  insights,
}: Props) {
  if (insights.length === 0) {
    return null;
  }

  return (
    <div className="card p-4">
      <h2 className="text-lg font-semibold text-grey-900 mb-4">
        Coach Insights
      </h2>

      <div className="space-y-2">
        {insights.map((insight, index) => (
          <div
            key={index}
            className={`rounded-lg p-3 text-sm break-words ${
              insight.type === 'positive'
                ? 'bg-success/10 text-success-strong' // .strong: text on a tint (see tailwind.config.js)
                : insight.type === 'warning'
                ? 'bg-error/10 text-error-strong'
                : 'bg-grey-600/10 text-grey-600'
            }`}
          >
            {insight.message}
          </div>
        ))}
      </div>
    </div>
  );
}