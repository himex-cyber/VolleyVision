import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FeedbackType } from '@prisma/client';
import { parseRequiredText, parseSeverity, parseType } from './feedbackValidation';

// ─── parseType ────────────────────────────────────────────────────────────────

describe('parseType', () => {
  it('accepts each valid feedback type', () => {
    assert.equal(parseType('BUG'), 'BUG');
    assert.equal(parseType('FEATURE_REQUEST'), 'FEATURE_REQUEST');
    assert.equal(parseType('GENERAL'), 'GENERAL');
  });

  it('rejects an invalid value with the documented message', () => {
    try {
      parseType('NOT_A_TYPE');
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, 'Feedback type must be BUG, FEATURE_REQUEST, or GENERAL.');
    }
  });

  it('rejects a missing value', () => {
    try {
      parseType(undefined);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
    }
  });
});

// ─── parseSeverity ────────────────────────────────────────────────────────────

describe('parseSeverity', () => {
  it('accepts each valid severity for BUG', () => {
    assert.equal(parseSeverity('LOW', FeedbackType.BUG), 'LOW');
    assert.equal(parseSeverity('MEDIUM', FeedbackType.BUG), 'MEDIUM');
    assert.equal(parseSeverity('HIGH', FeedbackType.BUG), 'HIGH');
  });

  it('rejects an invalid severity for BUG with the documented message', () => {
    try {
      parseSeverity('CRITICAL', FeedbackType.BUG);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, 'Severity must be LOW, MEDIUM, or HIGH.');
    }
  });

  it('is silently dropped (null) when type is not BUG, even with a value present', () => {
    assert.equal(parseSeverity('HIGH', FeedbackType.FEATURE_REQUEST), null);
    assert.equal(parseSeverity('HIGH', FeedbackType.GENERAL), null);
  });

  it('is silently dropped (null) when raw is null or empty, even for BUG', () => {
    assert.equal(parseSeverity(null, FeedbackType.BUG), null);
    assert.equal(parseSeverity(undefined, FeedbackType.BUG), null);
    assert.equal(parseSeverity('', FeedbackType.BUG), null);
  });
});

// ─── parseRequiredText ────────────────────────────────────────────────────────

describe('parseRequiredText', () => {
  it('trims surrounding whitespace', () => {
    assert.equal(parseRequiredText('  Nice serve today!  ', 'Subject', 200), 'Nice serve today!');
  });

  it('rejects empty and whitespace-only input', () => {
    for (const raw of ['', '   \n\t ']) {
      try {
        parseRequiredText(raw, 'Subject', 200);
        assert.fail('should have thrown');
      } catch (err: any) {
        assert.equal(err.statusCode, 400);
        assert.equal(err.message, 'Subject is required.');
      }
    }
  });

  it('rejects a non-string value', () => {
    try {
      parseRequiredText(undefined, 'Subject', 200);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, 'Subject is required.');
    }
  });

  it('accepts exactly the max length and rejects one char over', () => {
    assert.equal(parseRequiredText('a'.repeat(200), 'Subject', 200), 'a'.repeat(200));
    try {
      parseRequiredText('a'.repeat(201), 'Subject', 200);
      assert.fail('should have thrown');
    } catch (err: any) {
      assert.equal(err.statusCode, 400);
      assert.equal(err.message, 'Subject must be at most 200 characters.');
    }
  });
});
