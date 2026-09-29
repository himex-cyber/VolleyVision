import { downloadCsv } from '../../lib/csv';
import { isNative } from '../../lib/native';

// Hidden on the app: the Android WebView ignores blob: downloads, so the
// button would do nothing. `build` runs on click so nothing is serialised
// for a table nobody exports.
// `stale`: the rows on screen are still the previous range's (placeholderData),
// while the file name already says the new one.
export default function CsvButton({ filename, build, stale = false }: { filename: string; build: () => string; stale?: boolean }) {
  if (isNative()) return null;
  return (
    <button
      type="button"
      onClick={() => downloadCsv(filename, build())}
      disabled={stale}
      className="btn-secondary min-h-[44px] px-4 py-2 text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      Download CSV
    </button>
  );
}
