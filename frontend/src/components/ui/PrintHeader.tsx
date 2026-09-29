import { format } from 'date-fns';

/**
 * Printed pages only (8.7): what the sheet is and when it was printed, since
 * the app's own header and navigation are hidden in print. `lines` are the
 * page's own labels (team, match or date range): nothing is fetched for it.
 */
export default function PrintHeader({ lines }: { lines: (string | null | undefined)[] }) {
  return (
    <div className="hidden print:block border-b border-grey-200 pb-3 mb-4">
      <p className="font-display font-bold text-xl text-navy-700">VolleyVision</p>
      {lines.filter(Boolean).map((line) => (
        <p key={line} className="text-sm text-grey-900">{line}</p>
      ))}
      <p className="text-xs text-grey-600">Printed {format(new Date(), 'd MMM yyyy')}</p>
    </div>
  );
}
