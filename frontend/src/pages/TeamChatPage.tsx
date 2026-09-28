import { useParams } from 'react-router-dom';
import { useTeam, useTeamRole } from '../hooks';
import {
  useTeamChannel,
  useMessages,
  usePostMessage,
  useUploadMessage,
  useEditMessage,
  useDeleteMessage,
} from '../hooks/chat';
import { useAuth } from '../context/AuthContext';
import TeamSubNav from '../components/ui/TeamSubNav';
import MessageList from '../components/chat/MessageList';
import MessageComposer from '../components/chat/MessageComposer';

function LoadingSkeleton() {
  return (
    <div className="flex-1 p-5 space-y-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-start gap-3 animate-pulse">
          <div className="w-9 h-9 rounded-full bg-grey-200 shrink-0" />
          <div className="flex-1 space-y-2 py-1">
            <div className="h-3 bg-grey-200 rounded w-32" />
            <div className="h-3 bg-grey-200 rounded w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function TeamChatPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const { user } = useAuth();
  const { data: team } = useTeam(teamId!);
  const { data: roleInfo } = useTeamRole(teamId!);
  const { data: channel, isLoading: channelLoading, isError: channelError } = useTeamChannel(teamId!);

  const {
    data: messages,
    isLoading: messagesLoading,
    isError: messagesError,
    loadOlder,
    isLoadingOlder,
    hasMoreOlder,
    refreshLatest,
  } = useMessages(channel?.id);
  const { send, retry, discardFailed } = usePostMessage(channel?.id);
  const { sendWithFiles, retryUpload, discardUpload, ownsTempId } = useUploadMessage(channel?.id);
  const editMessage = useEditMessage(channel?.id);
  const deleteMessage = useDeleteMessage(channel?.id);

  const canPost = roleInfo?.permissions.includes('POST_MESSAGE') ?? false;
  const isViewer = roleInfo?.role === 'VIEWER';
  const canModerate =
    (!!roleInfo && (roleInfo.isOwner || roleInfo.role === 'HEAD_COACH' || roleInfo.role === 'MANAGER')) ||
    user?.role === 'ADMIN';

  const isLoading = channelLoading || (!!channel && messagesLoading);

  return (
    <div className="space-y-6">
      <TeamSubNav teamId={teamId!} teamName={team?.name} />
      <div>
        <h1 className="text-2xl font-bold text-grey-900">Team Chat</h1>
        <p className="text-sm text-grey-600 mt-1">
          Talk strategy and coordinate with everyone on {team?.name ?? 'the team'}.
        </p>
      </div>

      <div className="card flex flex-col h-[calc(100vh-16.5rem-var(--vv-safe-top)-var(--vv-safe-bottom))] min-h-[24rem] overflow-hidden">
        {channelError || messagesError ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <p className="text-error text-sm">Couldn't load the team chat. Please try again.</p>
          </div>
        ) : isLoading ? (
          <LoadingSkeleton />
        ) : (
          <MessageList
            messages={messages ?? []}
            currentUserId={user?.id}
            canPost={canPost}
            canModerate={canModerate}
            hasMoreOlder={hasMoreOlder}
            isLoadingOlder={isLoadingOlder}
            onLoadOlder={loadOlder}
            onEdit={(messageId, body) => editMessage.mutate({ messageId, body })}
            onDelete={(messageId) => deleteMessage.mutate(messageId)}
            // Failed sends route back to whichever hook created them.
            onRetry={(tempId) => (ownsTempId(tempId) ? retryUpload(tempId) : retry(tempId))}
            onDiscardFailed={(tempId) => (ownsTempId(tempId) ? discardUpload(tempId) : discardFailed(tempId))}
            onStaleAttachment={refreshLatest}
          />
        )}

        {canPost ? (
          <MessageComposer
            onSend={send}
            onSendWithFiles={sendWithFiles}
            disabled={!channel || !!channelError}
          />
        ) : isViewer ? (
          <div className="border-t border-grey-200 px-4 py-3">
            <p className="text-xs text-grey-600">
              You have view-only access to this team, so you can read the chat but not post.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
