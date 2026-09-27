import { useState } from 'react';
import { feedbackApi, getApiErrorMessage } from '../../lib/api';

// Admin-only check that Sentry works on the live site, end to end, and that its
// privacy scrubbing does. Each button plants PROBE in a query string. In Sentry,
// both events must arrive and PROBE must appear nowhere in either of them. If it
// does, a scrubber has regressed: src/main.tsx for the browser,
// backend/src/instrument.ts and backend/netlify-functions/api.js for the API.
const PROBE = 'sentry-probe-should-not-appear';

export default function SentryTestCard() {
  const [status, setStatus] = useState('');

  function sendBrowserError() {
    const original = window.location.href;
    // Keep React Router's history state; only the URL changes, and only briefly.
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?probe=${PROBE}`);
    setTimeout(() => {
      setTimeout(() => window.history.replaceState(window.history.state, '', original));
      // Thrown outside React and never caught, so it takes the same path a
      // real crash does: Sentry's global error handler.
      throw new Error('Sentry test (browser): sent on purpose by an admin from the Feedback page');
    });
    setStatus('Browser test error sent. Check Sentry.');
  }

  async function sendApiError() {
    try {
      await feedbackApi.sentryTest(PROBE);
      setStatus('The API accepted the test, which it never should. Check the function logs.');
    } catch (err) {
      // A 500 is the success case: the endpoint exists only to fail.
      const code = (err as { response?: { status?: number } }).response?.status;
      setStatus(code === 500 ? 'API test error sent. Check Sentry.' : getApiErrorMessage(err, 'The API test did not run.'));
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div>
        <h2 className="font-semibold text-grey-900">Sentry check</h2>
        <p className="text-grey-600 text-sm mt-0.5">
          Sends one test error from this browser and one from the API. Both should appear in Sentry within a minute,
          with no &ldquo;{PROBE}&rdquo; anywhere in them.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn-ghost text-sm px-3 py-1.5" onClick={sendBrowserError}>
          Send browser test error
        </button>
        <button type="button" className="btn-ghost text-sm px-3 py-1.5" onClick={sendApiError}>
          Send API test error
        </button>
      </div>
      {status && <p className="text-grey-600 text-xs">{status}</p>}
    </div>
  );
}
