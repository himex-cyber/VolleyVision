import { legalHref, type LegalPage } from '../../lib/legal';

const PAGES: [LegalPage, string][] = [['privacy', 'Privacy'], ['terms', 'Terms'], ['support', 'Support']];

/** Privacy, Terms and Support (9.2): plain links to the static pages, never router links. */
export default function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap justify-center gap-x-5 text-sm text-grey-600 ${className}`}>
      {PAGES.map(([page, label]) => (
        <a key={page} href={legalHref(page)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] hover:text-navy-700">
          {label}
        </a>
      ))}
    </nav>
  );
}
