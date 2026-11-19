export const COMMANDS = ['Output', 'Viewport', 'Set', 'Goto', 'Click', 'Type', 'Press', 'Scroll', 'Wait', 'Sleep'] as const;
export const SETTINGS = ['Framerate', 'Theme', 'TypingSpeed'] as const;

// "..." (only \" and \\ escape) | '...' (no escapes) | a lone quote = unterminated | bare word.
// Quotes only count at the start of a token, so text="Foo" stays one bare word.
const TOKEN = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(["'])|\S+/g;

export function tokenize(line: string): string[] {
  return [...line.matchAll(TOKEN)].map(([word, double, single, lone]) => {
    if (lone) throw new Error('Unterminated string');
    if (double !== undefined) return double.replace(/\\(["\\])/g, '$1');
    return single ?? word;
  });
}

export function parseDuration(s: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(ms|s)$/.exec(s);
  // "1.1e3" parses exactly, unlike 1.1 * 1000.
  return m ? Number(m[2] === 's' ? `${m[1]}e3` : m[1]) : undefined;
}

export function formatDuration(ms: number): string {
  return ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
}

export function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

export function suggest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = editDistance(word, c);
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best;
}
