import { useBlocks, useUnblock } from '../../hooks/chat';
import { getApiErrorMessage } from '../../lib/api';

/** Profile → Blocked members (9.6): who you've blocked in team chats, with unblock. */
export default function BlockedMembers() {
  const { data: blocks, isLoading, isError } = useBlocks();
  const unblock = useUnblock();

  return (
    <div className="card p-5">
      <h2 className="font-display text-xl text-grey-900 mb-1">Blocked members</h2>
      <p className="text-sm text-grey-600 mb-2">You don't see their messages in team chats. Everything else, like stats and tracking, is unchanged.</p>
      {isLoading ? (
        <p className="text-sm text-grey-600">Loading…</p>
      ) : isError ? (
        <p className="text-sm text-error-strong">Couldn't load your blocked members. Try refreshing the page.</p>
      ) : !blocks?.length ? (
        <p className="text-sm text-grey-600">You haven't blocked anyone.</p>
      ) : (
        <ul className="divide-y divide-grey-200">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-3">
              <span className="text-sm text-grey-900 truncate">{b.name}</span>
              <button
                type="button"
                className="text-sm font-medium text-navy-700 min-h-[44px] px-2 shrink-0"
                disabled={unblock.isPending}
                onClick={() => unblock.mutate(b.id, { onError: (err) => window.alert(getApiErrorMessage(err, "Couldn't unblock. Try again.")) })}
              >
                Unblock
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
