// Objectionable-words filter for team chat (9.7; Apple guideline 1.2 asks for
// a way to filter objectionable material). Matched words are masked as ****
// rather than the message refused: refusing a courtside message is worse
// than a masked word. Reporting (9.5) and blocking (9.6) handle the rest.
//
// ponytail: deliberately minimal. A short list, whole words, case-insensitive,
// common digit/symbol swaps; no spacing tricks, repeated letters or other
// languages. Message bodies only (not names or notes). Grow the list, or move
// to a maintained word list, if reports show it's needed.

const WORDS = new Set([
  'fuck', 'fucks', 'fucked', 'fucker', 'fuckers', 'fucking', 'motherfucker', 'fk', 'fck',
  'shit', 'shits', 'shitty', 'bullshit',
  'cunt', 'cunts', 'bitch', 'bitches', 'whore', 'whores', 'slut', 'sluts', 'bastard', 'bastards',
  'wanker', 'wankers', 'twat', 'twats', 'pussy', 'dickhead', 'dickheads', 'arsehole', 'asshole', 'assholes',
  'nigger', 'niggers', 'nigga', 'niggas', 'faggot', 'faggots', 'fag', 'fags', 'retard', 'retards', 'retarded',
  'spastic', 'tranny', 'kys',
]);

// Swaps people use to dodge a filter: 5h1t, $hit, @sshole.
const SWAPS: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't' };

// A "word": letters (any script, macrons included), digits, @ and $, and a
// ! only between those (sh!t), so a trailing ! stays punctuation.
const WORD = /[\p{L}\p{N}@$]+(?:!+[\p{L}\p{N}@$]+)*/gu;

export function maskObjectionable(text: string): string {
  return text.replace(WORD, (word) => {
    const plain = word.toLowerCase().replace(/[0-9@$!]/g, (c) => SWAPS[c] ?? c);
    return WORDS.has(plain) ? '****' : word;
  });
}
