import clsx from 'clsx';

/**
 * Whether the tracker's taps have reached the server (6.9). Always visible on
 * the tracker, so a statistician can tell at a glance that a dropped gym wifi
 * hasn't lost anything.
 */
export default function SyncBadge({ waiting, rejected, offline, stuck }: { waiting: number; rejected: number; offline: boolean; stuck: boolean }) {
  const [label, tone] =
    rejected > 0 ? [`${rejected} not saved`, 'bg-error/15 text-error-strong border-error/30']
    : waiting > 0 && stuck ? [`Can't save right now — ${waiting} waiting. Keep tracking; we'll keep trying.`, 'bg-gold-500/15 text-navy-900 border-gold-500/40']
    : waiting > 0 && offline ? [`Offline — ${waiting} waiting`, 'bg-gold-500/15 text-navy-900 border-gold-500/40']
    : waiting > 0 ? [`Saving… (${waiting})`, 'bg-navy-100 text-navy-700 border-navy-500']
    : ['All saved', 'bg-success/15 text-success-strong border-success/30'];
  return (
    <span
      role="status"
      aria-live="polite"
      className={clsx('inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border text-sm font-semibold tabular-nums', tone)}
    >
      <span aria-hidden="true" className={clsx('w-2 h-2 rounded-full bg-current', waiting > 0 && !offline && !stuck && 'animate-pulse')} />
      {label}
    </span>
  );
}
