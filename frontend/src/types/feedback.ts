// Feedback tab — client-side mirrors of the backend Feedback models
// (backend/prisma/schema.prisma + feedback.service.ts serialization).

export type FeedbackType = 'BUG' | 'FEATURE_REQUEST' | 'GENERAL';
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
