// Feedback tab — client-side mirrors of the backend Feedback models
// (backend/prisma/schema.prisma + feedback.service.ts serialization).

// MESSAGE_REPORT rows come only from reporting a chat message (9.5); users
// can't pick it on the feedback form (TYPE_OPTIONS leaves it out).
export type FeedbackType = 'BUG' | 'FEATURE_REQUEST' | 'GENERAL' | 'MESSAGE_REPORT';
export type FeedbackSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type FeedbackStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WONT_FIX';

export interface FeedbackAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  kind: 'IMAGE' | 'FILE';
  sizeBytes: number;
  width: number | null;
  height: number | null;
}

export interface Feedback {
  id: string;
  type: FeedbackType;
  severity: FeedbackSeverity | null;
  subject: string;
  description: string;
  status: FeedbackStatus;
  adminNotes: string | null;
  pageContext: string | null;
  /** The reported chat message (MESSAGE_REPORT only). */
  reportedMessageId?: string | null;
  attachments: FeedbackAttachment[];
  createdAt: string;
  updatedAt: string;
  user?: { firstName: string; lastName: string; email: string }; // only present on admin's listAll
}

/** Cursor-paginated response from GET /feedback/mine and GET /feedback. */
export interface FeedbackPage {
  items: Feedback[];
  nextCursor: string | null;
}
