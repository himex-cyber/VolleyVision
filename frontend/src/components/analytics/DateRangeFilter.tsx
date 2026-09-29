import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { subDays, subMonths } from 'date-fns';
import type { DateRange } from '../../types';
import { useDateRangeParams, ymd } from '../../lib/dateRange';

type Mode = 'all' | '30d' | '3m' | 'custom';

export default function DateRangeFilter({ season }: { season?: string }) {
  const [params, setParams] = useSearchParams();
  const range = useDateRangeParams();
  const [customOpen, setCustomOpen] = useState(false);

  const today = new Date();
  const last30 = { from: ymd(subDays(today, 30)), to: ymd(today) };
  const last3m = { from: ymd(subMonths(today, 3)), to: ymd(today) };

  const is = (r: { from: string; to: string }) => range.from === r.from && range.to === r.to;
  const mode: Mode = customOpen
    ? 'custom'
    : !range.from && !range.to ? 'all' : is(last30) ? '30d' : is(last3m) ? '3m' : 'custom';

  // Other params (teamId, matchId…) stay put; replace so Back leaves the page
  // instead of stepping through every filter tweak.
  function apply(next: DateRange) {
    const p = new URLSearchParams(params);
    if (next.from) p.set('from', next.from); else p.delete('from');
    if (next.to) p.set('to', next.to); else p.delete('to');
    setParams(p, { replace: true });
  }

  function pick(m: Mode) {
    setCustomOpen(m === 'custom');
    if (m === 'all') apply({});
    else if (m === '30d') apply(last30);
    else if (m === '3m') apply(last3m);
  }

  const presets: Array<[Mode, string]> = [
    ['all', season ? `All matches · Season ${season}` : 'All matches'],
    ['30d', 'Last 30 days'],
    ['3m', 'Last 3 months'],
    ['custom', 'Custom'],
  ];

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range">
        {presets.map(([m, label]) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => pick(m)}
            className={`min-h-[44px] px-4 rounded-xl border text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-500 ${
              mode === m
                ? 'bg-navy-700 border-navy-700 text-white'
                : 'bg-white border-grey-200 text-navy-700 hover:bg-grey-50'
            }`}
          >
            {label}
          </button>
        ))}
        {mode !== 'all' && (
          <button
            type="button"
            onClick={() => pick('all')}
            className="min-h-[44px] px-2 text-sm font-medium text-navy-700 underline"
          >
            Clear
          </button>
        )}
      </div>

      {mode === 'custom' && (
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-grey-600 flex-1 min-w-[140px]">
            From
            <input
              type="date"
              className="input min-h-[44px] mt-1"
              value={range.from ?? ''}
              max={range.to}
              onChange={(e) => apply({ ...range, from: e.target.value || undefined })}
            />
          </label>
          <label className="text-sm text-grey-600 flex-1 min-w-[140px]">
            To
            <input
              type="date"
              className="input min-h-[44px] mt-1"
              value={range.to ?? ''}
              min={range.from}
              onChange={(e) => apply({ ...range, to: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
    </div>
  );
}
