import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sniffMimeType, resolveUploadContentType, isInlineRenderableKey } from './fileSignature';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const GIF = Buffer.from('GIF89a' + '\x00'.repeat(4), 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBP', 'latin1')]);
const PDF = Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3', 'latin1');
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]);
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
const ASCII_TEXT = Buffer.from('name,age\nMia,22\nKarlos,31\n', 'utf8');
// MZ = classic DOS/PE executable header; NUL bytes appear a few bytes in.
const MZ_EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00]);

// ─── sniffMimeType ────────────────────────────────────────────────────────────

describe('sniffMimeType', () => {
  it('identifies each known container from its leading bytes', () => {
    assert.equal(sniffMimeType(PNG), 'image/png');
    assert.equal(sniffMimeType(JPEG), 'image/jpeg');
    assert.equal(sniffMimeType(GIF), 'image/gif');
    assert.equal(sniffMimeType(WEBP), 'image/webp');
    assert.equal(sniffMimeType(PDF), 'application/pdf');
    assert.equal(sniffMimeType(ZIP), 'application/zip');
    assert.equal(sniffMimeType(OLE), 'application/x-ole-storage');
  });

  it('returns null for plain ASCII text', () => {
    assert.equal(sniffMimeType(ASCII_TEXT), null);
  });

  it('returns null for an empty or too-short buffer', () => {
    assert.equal(sniffMimeType(Buffer.alloc(0)), null);
    assert.equal(sniffMimeType(Buffer.from([0x89, 0x50])), null);
  });
});

// ─── resolveUploadContentType — accepted cases ───────────────────────────────

describe('resolveUploadContentType — matches', () => {
  it('returns the sniffed type for each exact-match image/PDF declaration', () => {
    assert.equal(resolveUploadContentType('image/png', PNG), 'image/png');
    assert.equal(resolveUploadContentType('image/jpeg', JPEG), 'image/jpeg');
    assert.equal(resolveUploadContentType('image/gif', GIF), 'image/gif');
    assert.equal(resolveUploadContentType('image/webp', WEBP), 'image/webp');
    assert.equal(resolveUploadContentType('application/pdf', PDF), 'application/pdf');
  });

  it('accepts a docx declared over ZIP bytes, returning the declared type', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    assert.equal(resolveUploadContentType(docx, ZIP), docx);
  });

  it('accepts an xls declared over OLE bytes, returning the declared type', () => {
    assert.equal(resolveUploadContentType('application/vnd.ms-excel', OLE), 'application/vnd.ms-excel');
  });

  it('accepts text/plain over ASCII bytes', () => {
    assert.equal(resolveUploadContentType('text/plain', ASCII_TEXT), 'text/plain');
  });
});

// ─── resolveUploadContentType — mismatches ───────────────────────────────────

describe('resolveUploadContentType — mismatches throw AppError(400)', () => {
  it('rejects a PNG-declared buffer that actually holds JPEG bytes', () => {
    try {
      resolveUploadContentType('image/png', JPEG);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
    }
  });

  it('rejects a text/plain declaration whose bytes contain a NUL byte (renamed executable)', () => {
    try {
      resolveUploadContentType('text/plain', MZ_EXE);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
    }
  });

  it('rejects a declared type that is not on either allow-list', () => {
    try {
      resolveUploadContentType('application/x-msdownload', MZ_EXE);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
    }
  });
});

// ─── isInlineRenderableKey ────────────────────────────────────────────────────

describe('isInlineRenderableKey', () => {
  it('is true for an image key and false for a .pdf key', () => {
    assert.equal(isInlineRenderableKey('teams/t1/channels/c1/m1/uuid-photo.png'), true);
    assert.equal(isInlineRenderableKey('teams/t1/channels/c1/m1/uuid-report.pdf'), false);
  });
});
