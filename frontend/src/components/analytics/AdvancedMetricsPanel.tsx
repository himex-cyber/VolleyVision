import type { ReactNode } from 'react';
import { useAdvancedMetrics } from '../../hooks';

// Volleyball-style hitting percentage from a fraction: ".214", "-.100".
function formatHitting(v: number | null): string {
  if (v == null) return '–';
  const digits = Math.abs(v).toFixed(3);
  const s = Math.abs(v) >= 1 ? digits : digits.slice(1);
  return v < 0 ? `-${s}` : s;
}

// Percentages arrive already 0–100.
const pct = (v: number | null) => (v == null ? '–' : `${v}%`);
const num = (v: number | null) => (v == null ? '–' : String(v));

function Headline({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-grey-600">{label}</p>
      <p className="tabular-nums text-2xl font-bold text-grey-900 leading-none mt-2">{value}</p>
      {detail && <p className="text-xs text-grey-600 mt-2">{detail}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="text-lg font-semibold text-grey-900 mb-3">{title}</h3>
      <div className="card p-4">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-xs text-grey-600">{label}</dt>
          <dd className="tabular-nums text-lg font-semibold text-grey-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AdvancedMetricsPanel({ scope, id, canTrack = false }: {
  scope: 'match' | 'team';
  id: string;
  canTrack?: boolean;
}) {
  const { data, isLoading, isError } = useAdvancedMetrics(scope, id);

  if (isLoading) return <div className="card h-40 bg-grey-50 animate-pulse" aria-busy="true" />;
  if (isError || !data) {
    return <p className="card p-4 text-sm text-error-strong text-center">Couldn't load advanced metrics. Try refreshing the page.</p>;
  }

  const { sideOut, serve, attack, blocking, receptionQuality: rq } = data;
  const { withServingSide, totalPoints } = sideOut.coverage;

  const empty = serve.attempts === 0 && attack.attempts === 0 && rq.attempts === 0
    && blocking.totalBlocks === 0 && totalPoints === 0;
  if (empty) {
    return (
      <div className="card p-4">
        <h3 className="font-display font-semibold text-grey-900">Advanced</h3>
        <p className="text-sm text-grey-600 text-center py-6">
          Nothing tracked yet.{canTrack && ' Track a match and serve, attack, block and pass figures show up here.'}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h3 className="font-display font-semibold text-grey-900">Advanced</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Headline label="Side-out %" value={pct(sideOut.sideOutPct)} detail={`of ${sideOut.receiveRallies} receive rallies`} />
        <Headline label="Break-point %" value={pct(sideOut.breakPointPct)} detail={`of ${sideOut.serveRallies} serve rallies`} />
        <Headline label="Ace rate" value={pct(serve.aceRate)} detail={`${serve.aces} aces`} />
        <Headline label="Kill rate" value={pct(attack.killRate)} detail={`${attack.kills} of ${attack.attempts}`} />
      </div>

      {totalPoints > 0 && withServingSide < totalPoints && (
        <p className="text-xs text-grey-600">
          {withServingSide === 0
            ? `Side-out needs the serving side.${canTrack ? ' Set Serving: Us/Them while you track.' : ''}`
            : `Side-out and break-point use ${withServingSide} of ${totalPoints} points, the ones with a serving side.`}
        </p>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <Section title="Serve">
          <Rows rows={[
            ['Attempts', String(serve.attempts)], ['Aces', String(serve.aces)], ['Errors', String(serve.errors)],
            ['Ace rate', pct(serve.aceRate)], ['Error rate', pct(serve.errorRate)], ['In or ace', pct(serve.positiveRate)],
          ]} />
        </Section>
        <Section title="Attack">
          <Rows rows={[
            ['Attempts', String(attack.attempts)], ['Kills', String(attack.kills)], ['Errors', String(attack.errors)],
            ['Kill rate', pct(attack.killRate)], ['Hitting %', formatHitting(attack.hittingPct)],
          ]} />
        </Section>
        <Section title="Blocking">
          <Rows rows={[
            ['Solo', String(blocking.soloBlocks)], ['Assists', String(blocking.blockAssists)],
            ['Total blocks', String(blocking.totalBlocks)], ['Blocks per set', num(blocking.blocksPerSet)],
          ]} />
        </Section>
        <Section title="Serve receive quality">
          <Rows rows={[
            ['Passes graded 2 or 3', pct(rq.qualityPct)], ['Perfect pass rate', pct(rq.perfectPassRate)],
            ['Passes', String(rq.attempts)],
          ]} />
          <div className="grid grid-cols-4 gap-2 pt-3 mt-3 border-t border-grey-200 text-center">
            {([['3', rq.pass3], ['2', rq.pass2], ['1', rq.pass1], ['0', rq.pass0]] as const).map(([g, n]) => (
              <div key={g}>
                <p className="tabular-nums text-lg font-bold text-grey-900">{n}</p>
                <p className="text-xs text-grey-600">Pass {g}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
