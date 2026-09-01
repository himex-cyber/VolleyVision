import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isYouTubeVideoId, parseYouTubeVideoId, youtubeOEmbedUrl, youtubeWatchUrl } from './youtubeUrl';

const ID = 'dQw4w9WgXcQ'; // 11 chars, mixed case, no special characters
const ID_WITH_SYMBOLS = 'a_b-c1D2e3F'; // exercises the _ and - in the alphabet

// ─── Accepted forms ───────────────────────────────────────────────────────────

describe('parseYouTubeVideoId — canonical watch URLs', () => {
  it('parses the standard watch URL', () => {
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}`), ID);
  });

  it('ignores extra query params in any order', () => {
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?v=${ID}&t=42s`), ID);
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/watch?list=PL123&v=${ID}&index=2`), ID);
  });

  it('accepts every host variant', () => {
    for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']) {
      assert.equal(parseYouTubeVideoId(`https://${host}/watch?v=${ID}`), ID, host);
    }
  });

  it('accepts http as well as https', () => {
    assert.equal(parseYouTubeVideoId(`http://www.youtube.com/watch?v=${ID}`), ID);
  });

  it('accepts a scheme-less paste', () => {
    assert.equal(parseYouTubeVideoId(`youtube.com/watch?v=${ID}`), ID);
    assert.equal(parseYouTubeVideoId(`www.youtube.com/watch?v=${ID}`), ID);
  });
});

describe('parseYouTubeVideoId — short and alternate paths', () => {
  it('parses youtu.be links, with and without a timestamp', () => {
    assert.equal(parseYouTubeVideoId(`https://youtu.be/${ID}`), ID);
    assert.equal(parseYouTubeVideoId(`https://youtu.be/${ID}?t=90`), ID);
  });

  it('parses embed, shorts, live and /v/ paths', () => {
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/embed/${ID}`), ID);
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/live/${ID}`), ID);
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com/v/${ID}`), ID);
  });

  it('parses the privacy-enhanced nocookie host', () => {
    assert.equal(parseYouTubeVideoId(`https://www.youtube-nocookie.com/embed/${ID}`), ID);
  });

  it('accepts a bare 11-character id', () => {
    assert.equal(parseYouTubeVideoId(ID), ID);
    assert.equal(parseYouTubeVideoId(ID_WITH_SYMBOLS), ID_WITH_SYMBOLS);
  });

  it('trims surrounding whitespace from a paste', () => {
    assert.equal(parseYouTubeVideoId(`  https://youtu.be/${ID}  \n`), ID);
  });
});

// ─── Rejected: hostile input ──────────────────────────────────────────────────

describe('parseYouTubeVideoId — hostile hosts', () => {
  it('rejects a lookalike host whose real domain is not YouTube', () => {
    // The reason this parses the URL instead of regexing the string: a pattern
    // looking for "youtube.com" anywhere matches all of these.
    assert.equal(parseYouTubeVideoId(`https://youtube.com.evil.com/watch?v=${ID}`), null);
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com.evil.com/watch?v=${ID}`), null);
    assert.equal(parseYouTubeVideoId(`https://evil-youtube.com/watch?v=${ID}`), null);
    assert.equal(parseYouTubeVideoId(`https://notyoutube.com/watch?v=${ID}`), null);
  });

  it('rejects a YouTube-looking path on an unrelated host', () => {
    assert.equal(parseYouTubeVideoId(`https://evil.com/youtube.com/watch?v=${ID}`), null);
    assert.equal(parseYouTubeVideoId(`https://evil.com/embed/${ID}`), null);
  });

  it('rejects credentials-in-URL pointing the real host elsewhere', () => {
    // Host here is evil.com; "www.youtube.com" is only the userinfo part.
    assert.equal(parseYouTubeVideoId(`https://www.youtube.com@evil.com/watch?v=${ID}`), null);
  });

  it('rejects non-http schemes', () => {
    assert.equal(parseYouTubeVideoId(`javascript:alert(1)//youtube.com/watch?v=${ID}`), null);
    assert.equal(parseYouTubeVideoId(`data:text/html,<script>alert(1)</script>`), null);
  });

  it('rejects other video platforms', () => {
    assert.equal(parseYouTubeVideoId('https://vimeo.com/123456789'), null);
    assert.equal(parseYouTubeVideoId('https://www.dailymotion.com/video/x8abcde'), null);
  });
});

// ─── Rejected: malformed input ────────────────────────────────────────────────

describe('parseYouTubeVideoId — malformed input', () => {
  it('rejects ids of the wrong length', () => {
    assert.equal(parseYouTubeVideoId('https://youtu.be/tooshort'), null);
    assert.equal(parseYouTubeVideoId(`https://youtu.be/${ID}EXTRA`), null);
    assert.equal(parseYouTubeVideoId('abcdefghij'), null); // 10 chars
    assert.equal(parseYouTubeVideoId('abcdefghijkl'), null); // 12 chars
  });

  it('rejects ids containing characters outside the alphabet', () => {
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/watch?v=abcdefghij!'), null);
    assert.equal(parseYouTubeVideoId('dQw4w9WgXc.'), null);
  });

  it('rejects a YouTube URL with no video in it', () => {
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/'), null);
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/results?search_query=volleyball'), null);
    assert.equal(parseYouTubeVideoId('https://www.youtube.com/@somechannel'), null);
  });

  it('rejects empty, blank and non-string input without throwing', () => {
    assert.equal(parseYouTubeVideoId(''), null);
    assert.equal(parseYouTubeVideoId('   '), null);
    assert.equal(parseYouTubeVideoId(null as unknown as string), null);
    assert.equal(parseYouTubeVideoId(undefined as unknown as string), null);
    assert.equal(parseYouTubeVideoId(42 as unknown as string), null);
  });

  it('rejects unparseable junk', () => {
    assert.equal(parseYouTubeVideoId('not a url at all'), null);
    assert.equal(parseYouTubeVideoId('http://'), null);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

describe('isYouTubeVideoId', () => {
  it('accepts exactly 11 chars of the URL-safe alphabet', () => {
    assert.equal(isYouTubeVideoId(ID), true);
    assert.equal(isYouTubeVideoId(ID_WITH_SYMBOLS), true);
    assert.equal(isYouTubeVideoId('short'), false);
    assert.equal(isYouTubeVideoId('has spaces!'), false);
  });
});

describe('youtubeOEmbedUrl / youtubeWatchUrl', () => {
  it('builds the oEmbed URL from the parsed id, not from user input', () => {
    const url = youtubeOEmbedUrl(ID);
    assert.ok(url.startsWith('https://www.youtube.com/oembed?url='));
    assert.ok(url.includes(encodeURIComponent(`https://www.youtube.com/watch?v=${ID}`)));
    assert.ok(url.endsWith('&format=json'));
  });

  it('round-trips the watch URL back to the same id', () => {
    assert.equal(parseYouTubeVideoId(youtubeWatchUrl(ID)), ID);
  });
});
