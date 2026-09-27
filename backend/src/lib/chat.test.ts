import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_MESSAGE_LENGTH,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  validateMessageBody,
  clampPageSize,
  beforeCursorWhere,
  afterCursorWhere,
  editRejection,
  canDeleteMessage,
  serializeMessage,
  SerializedMessage,
} from './chat';
// Imported from lib/ rather than permission.service — the service pulls in
// lib/prisma, which instantiates a PrismaClient at module load.
import { Permission, roleHasPermission } from './rolePermissions';

// ─── validateMessageBody ──────────────────────────────────────────────────────

describe('validateMessageBody', () => {
  it('accepts a normal body and trims surrounding whitespace', () => {
    const result = validateMessageBody('  Nice serve today!  ');
    assert.deepEqual(result, { ok: true, body: 'Nice serve today!' });
  });

  it('rejects a missing or non-string body', () => {
    assert.equal(validateMessageBody(undefined).ok, false);
    assert.equal(validateMessageBody(null).ok, false);
    assert.equal(validateMessageBody(42).ok, false);
    assert.equal(validateMessageBody({}).ok, false);
  });

  it('rejects empty and whitespace-only bodies', () => {
    assert.equal(validateMessageBody('').ok, false);
    assert.equal(validateMessageBody('   \n\t ').ok, false);
  });

  it('accepts exactly the max length and rejects one char over', () => {
    assert.equal(validateMessageBody('a'.repeat(MAX_MESSAGE_LENGTH)).ok, true);
    assert.equal(validateMessageBody('a'.repeat(MAX_MESSAGE_LENGTH + 1)).ok, false);
  });

  it('measures length after trimming', () => {
    const padded = ` ${'a'.repeat(MAX_MESSAGE_LENGTH)} `;
    assert.equal(validateMessageBody(padded).ok, true);
  });
});

// ─── clampPageSize ────────────────────────────────────────────────────────────

describe('clampPageSize', () => {
  it('defaults when undefined or NaN', () => {
    assert.equal(clampPageSize(undefined), DEFAULT_PAGE_SIZE);
    assert.equal(clampPageSize(NaN), DEFAULT_PAGE_SIZE);
  });

  it('caps at the max page size and floors at 1', () => {
    assert.equal(clampPageSize(1000), MAX_PAGE_SIZE);
    assert.equal(clampPageSize(0), 1);
    assert.equal(clampPageSize(-5), 1);
  });

  it('passes sane values through, flooring fractions', () => {
    assert.equal(clampPageSize(30), 30);
    assert.equal(clampPageSize(12.9), 12);
  });
});

// ─── Cursor where-fragments ───────────────────────────────────────────────────

describe('cursor where-fragments', () => {
  const anchor = { createdAt: new Date('2026-07-17T10:00:00Z'), id: 'msg-b' };

  it('before = strictly older by (createdAt, id) tuple', () => {
    assert.deepEqual(beforeCursorWhere(anchor), {
      OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: 'msg-b' } },
      ],
    });
  });

  it('after = strictly newer by (createdAt, id) tuple', () => {
    assert.deepEqual(afterCursorWhere(anchor), {
      OR: [
        { createdAt: { gt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { gt: 'msg-b' } },
      ],
    });
  });
});

// ─── Edit / delete rules ──────────────────────────────────────────────────────

describe('editRejection', () => {
  it('allows the author to edit a live message', () => {
    assert.equal(editRejection({ senderId: 'u1', deletedAt: null }, 'u1'), null);
  });

  it('rejects a non-author with 403', () => {
    assert.equal(editRejection({ senderId: 'u1', deletedAt: null }, 'u2')?.status, 403);
  });

  it('deletion wins over edit: deleted message is 409 even for the author', () => {
    assert.equal(editRejection({ senderId: 'u1', deletedAt: new Date() }, 'u1')?.status, 409);
  });

  it('a former member message (senderId null) is not editable by anyone', () => {
    assert.equal(editRejection({ senderId: null, deletedAt: null }, 'u1')?.status, 403);
  });
});

describe('canDeleteMessage', () => {
  it('author can delete own; non-author cannot', () => {
    assert.equal(canDeleteMessage({ senderId: 'u1' }, 'u1', false), true);
    assert.equal(canDeleteMessage({ senderId: 'u1' }, 'u2', false), false);
  });

  it('moderator can delete anything, including former-member messages', () => {
    assert.equal(canDeleteMessage({ senderId: 'u1' }, 'u2', true), true);
    assert.equal(canDeleteMessage({ senderId: null }, 'u2', true), true);
  });
});

// ─── Tombstones ───────────────────────────────────────────────────────────────

describe('serializeMessage', () => {
  const base: SerializedMessage = {
    id: 'm1',
    channelId: 'c1',
    senderId: 'u1',
    sender: { id: 'u1', firstName: 'Mia', lastName: 'Taufa', profileImage: null },
    body: 'set point!',
    attachments: [{ id: 'a1' }],
    editedAt: new Date('2026-07-17T09:00:00Z'),
    deletedAt: null,
    createdAt: new Date('2026-07-17T08:00:00Z'),
  };

  it('returns a live message untouched', () => {
    assert.equal(serializeMessage(base), base);
  });

  it('strips body and attachments from a deleted message but keeps identity + timeline fields', () => {
    const deletedAt = new Date('2026-07-17T10:00:00Z');
    const tombstone = serializeMessage({ ...base, deletedAt });
    assert.equal(tombstone.body, null);
    assert.deepEqual(tombstone.attachments, []);
    assert.equal(tombstone.editedAt, null);
    assert.equal(tombstone.id, 'm1');
    assert.equal(tombstone.senderId, 'u1');
    assert.equal(tombstone.deletedAt, deletedAt);
    assert.equal(tombstone.createdAt, base.createdAt);
  });
});

// ─── Role → POST_MESSAGE grants ───────────────────────────────────────────────

describe('POST_MESSAGE permission map', () => {
  it('every role except VIEWER can post', () => {
    for (const role of ['HEAD_COACH', 'MANAGER', 'ASSISTANT_COACH', 'STATISTICIAN', 'PLAYER']) {
      assert.equal(roleHasPermission(role, Permission.POST_MESSAGE), true, `${role} should post`);
    }
    assert.equal(roleHasPermission('VIEWER', Permission.POST_MESSAGE), false);
  });

  it('VIEWER keeps read access to the team (and therefore the channel)', () => {
    assert.equal(roleHasPermission('VIEWER', Permission.VIEW_TEAM), true);
  });
});
