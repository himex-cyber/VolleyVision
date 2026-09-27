import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { roleRank, canInviteRole } from './rolePermissions';

describe('roleRank', () => {
  it('orders roles from most to least authority', () => {
    assert.ok(roleRank('HEAD_COACH') < roleRank('MANAGER'));
    assert.ok(roleRank('MANAGER') < roleRank('ASSISTANT_COACH'));
    assert.ok(roleRank('ASSISTANT_COACH') < roleRank('STATISTICIAN'));
    assert.ok(roleRank('STATISTICIAN') < roleRank('PLAYER'));
    assert.ok(roleRank('PLAYER') < roleRank('VIEWER'));
  });

  it('ranks an unknown role last', () => {
    assert.ok(roleRank('NOT_A_ROLE') > roleRank('VIEWER'));
  });
});

describe('canInviteRole', () => {
  it('never allows inviting a HEAD_COACH, even from another HEAD_COACH', () => {
    assert.equal(canInviteRole('HEAD_COACH', 'HEAD_COACH'), false);
    assert.equal(canInviteRole('MANAGER', 'HEAD_COACH'), false);
  });

  it('allows a role to invite its own rank or lower authority', () => {
    assert.equal(canInviteRole('MANAGER', 'MANAGER'), true);
    assert.equal(canInviteRole('MANAGER', 'ASSISTANT_COACH'), true);
    assert.equal(canInviteRole('MANAGER', 'VIEWER'), true);
  });

  it('blocks inviting a role that outranks the inviter', () => {
    assert.equal(canInviteRole('ASSISTANT_COACH', 'MANAGER'), false);
    assert.equal(canInviteRole('PLAYER', 'STATISTICIAN'), false);
  });
});
