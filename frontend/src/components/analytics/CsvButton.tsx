import { downloadCsv } from '../../lib/csv';
import { isNative } from '../../lib/native';

// Hidden on the app: the Android WebView ignores blob: downloads, so the
// button would do nothing. `build` runs on click so nothing is serialised
// for a table nobody exports.
export default function CsvButton({ filename, build }: { filename: string; build: () => string }) {
  if (isNative()) return null;
  return (
    <button
      type="button"
      onClick={() => downloadCsv(filename, build())}
      className="btn-secondary min-h-[44px] px-4 py-2 text-sm shrink-0"
    >
      Download CSV
    </button>
  );
}
