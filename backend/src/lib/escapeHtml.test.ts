import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  });

  it('neutralizes an injected tag', () => {
    assert.equal(
      escapeHtml('<img src=x onerror=alert(1)>'),
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });

  it('leaves plain text untouched', () => {
    assert.equal(escapeHtml("O'Brien Coach"), "O&#39;Brien Coach");
    assert.equal(escapeHtml('Team Alpha'), 'Team Alpha');
  });
});
