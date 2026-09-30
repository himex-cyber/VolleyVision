import { legalHref } from '../../lib/legal';

/** The 13+ and Terms tick box (9.3), on signup and on the one-time Terms step. */
export default function TermsConsent({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 min-h-[44px] text-sm text-grey-700 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-gold-500 w-5 h-5 mt-0.5 shrink-0"
        required
      />
      <span>
        I'm 13 or older and I agree to the{' '}
        <a href={legalHref('terms')} target="_blank" rel="noopener noreferrer" className="text-navy-700 font-medium underline">Terms</a>
        {' '}and{' '}
        <a href={legalHref('privacy')} target="_blank" rel="noopener noreferrer" className="text-navy-700 font-medium underline">Privacy Policy</a>.
      </span>
    </label>
  );
}
