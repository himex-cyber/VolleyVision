// 9.7: a deliberately small objectionable-words filter for chat (Apple 1.2).
import assert from 'node:assert/strict';
import { maskObjectionable } from './contentFilter';

assert.equal(maskObjectionable('great serve'), 'great serve', 'clean text is untouched');
assert.equal(maskObjectionable('that was shit'), 'that was ****');
assert.equal(maskObjectionable('SHIT happens'), '**** happens', 'any case');
assert.equal(maskObjectionable('sh1t and $hit and sh!t and f*ck'), '**** and **** and **** and f*ck', 'simple letter swaps (not every trick)');
assert.equal(maskObjectionable('shit, shit! shit?'), '****, ****! ****?', 'punctuation around a word');
assert.equal(maskObjectionable('Scunthorpe vs Essex, a classic assessment'), 'Scunthorpe vs Essex, a classic assessment', 'whole words only');
assert.equal(maskObjectionable('shitake mushrooms'), 'shitake mushrooms', 'no partial matches');
assert.equal(maskObjectionable('Tēnā koe, shit'), 'Tēnā koe, ****', 'macrons are letters');
assert.equal(maskObjectionable('line one\nshit\nline three'), 'line one\n****\nline three', 'line breaks kept');
assert.equal(maskObjectionable(''), '');

console.log('contentFilter.test.ts passed');
