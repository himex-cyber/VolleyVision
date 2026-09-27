import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAllowedProfileImageUrl } from './profileImage';

const SUPABASE_URL = 'https://abcxyz.supabase.co';

describe('isAllowedProfileImageUrl', () => {
  it('accepts an https URL on the Supabase storage host', () => {
    assert.equal(
      isAllowedProfileImageUrl('https://abcxyz.supabase.co/storage/v1/object/public/avatars/1.png', SUPABASE_URL),
      true,
    );
  });

  it('rejects http (non-https) even on the right host', () => {
    assert.equal(
      isAllowedProfileImageUrl('http://abcxyz.supabase.co/storage/v1/object/public/avatars/1.png', SUPABASE_URL),
      false,
    );
  });

  it('rejects a different host entirely', () => {
    assert.equal(isAllowedProfileImageUrl('https://evil.example.com/x.png', SUPABASE_URL), false);
  });

  it('rejects a look-alike host (subdomain confusion)', () => {
    assert.equal(isAllowedProfileImageUrl('https://abcxyz.supabase.co.evil.com/x.png', SUPABASE_URL), false);
  });

  it('rejects an unparsable URL, empty string, or missing SUPABASE_URL', () => {
    assert.equal(isAllowedProfileImageUrl('not a url', SUPABASE_URL), false);
    assert.equal(isAllowedProfileImageUrl('', SUPABASE_URL), false);
    assert.equal(isAllowedProfileImageUrl('https://abcxyz.supabase.co/x.png', undefined), false);
  });
});
