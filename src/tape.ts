import { resolve } from 'node:path';
import type { Format, Theme } from './shared';

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

export const CLICK_MOVE_MS = 500, CLICK_MS = 700, PRESS_MS = 200, SCROLL_DEFAULT_MS = 500;
export const SELECTOR_TIMEOUT_MS = 10_000, GOTO_TIMEOUT_MS = 30_000, WAIT_DEFAULT_MS = 10_000;

export interface Settings { width: number; height: number; fps: number; theme: Theme; typingSpeedMs: number }
export interface OutputDecl { path: string; format: Format; line: number }
export type Step =
  | { kind: 'Goto'; line: number; frames: number; url: string }
  | { kind: 'Click'; line: number; frames: number; selector: string }
  | { kind: 'Type'; line: number; frames: number; text: string }
  | { kind: 'Press'; line: number; frames: number; key: string }
  | { kind: 'Scroll'; line: number; frames: number; selector: string | null; pixels: number }
  | { kind: 'Wait'; line: number; frames: number; selector: string; timeoutMs: number }
  | { kind: 'Sleep'; line: number; frames: number };
export interface Script { settings: Settings; outputs: OutputDecl[]; steps: Step[]; totalFrames: number }
export interface TapeError { line: number; message: string }
export type ParseResult = { ok: true; script: Script } | { ok: false; errors: TapeError[] };

type Command = (typeof COMMANDS)[number];
type Fail = (message: string) => undefined;
interface State { settings: Settings; outputs: OutputDecl[]; steps: Step[]; seen: Set<string>; sawAction: boolean; baseDir: string }

const ACTIONS: readonly string[] = ['Goto', 'Click', 'Type', 'Press', 'Scroll', 'Wait', 'Sleep'];
const THEMES: readonly string[] = ['light', 'dark', 'none'];
const MAX_SECONDS = 300;
const USAGE: Record<Command, string> = {
  Output: 'Output <path>', Viewport: 'Viewport <width> <height>', Set: 'Set <Key> <Value>', Goto: 'Goto <url>',
  Click: 'Click <selector>', Type: 'Type <text>', Press: 'Press <key>', Scroll: 'Scroll [selector] <pixels> [duration]',
  Wait: 'Wait <selector> [timeout]', Sleep: 'Sleep <duration>',
};
// [min, max] argument counts. Scroll splits off its optional duration later.
const ARITY: Record<Command, [number, number]> = {
  Output: [1, 1], Viewport: [2, 2], Set: [2, 2], Goto: [1, 1], Click: [1, 1],
  Type: [1, 1], Press: [1, 1], Scroll: [1, 3], Wait: [1, 2], Sleep: [1, 1],
};

/** Where an output really goes, for spotting duplicates: resolved, with either slash, ignoring case. */
export function destinationKey(path: string, baseDir: string): string {
  return resolve(baseDir, path.replaceAll('\\', '/')).toLowerCase();
}

export function formatOf(path: string): Format | undefined {
  return /\.(gif|webm|mp4)$/i.exec(path)?.[1].toLowerCase() as Format | undefined;
}

export function framesFor(ms: number, fps: number): number {
  return Math.round(ms * fps / 1000);
}

export function charsDue(frameIndex: number, frames: number, length: number): number {
  return Math.ceil((frameIndex + 1) * length / frames);
}

const isInt = (s: string, min: number, max: number) => /^-?\d+$/.test(s) && +s >= min && +s <= max;
const isEven = (s: string, min: number, max: number) => isInt(s, min, max) && +s % 2 === 0;
const durationOf = (s: string, fail: Fail) => parseDuration(s) ?? fail(`Invalid duration "${s}" (use e.g. 500ms or 1.5s)`);

function unknown(what: string, word: string, candidates: readonly string[]): string {
  const s = suggest(word, candidates);
  return `Unknown ${what} "${word}"${s ? `. Did you mean "${s}"?` : ''}`;
}

// PowerShell 5.1's Out-File and > write UTF-16LE. TextDecoder drops the BOM by default.
export function decodeTape(bytes: Uint8Array): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  return new TextDecoder(encoding).decode(bytes);
}

/** baseDir is the tape's directory, which relative Output paths are resolved against. */
export function parseTape(source: string, baseDir = '.'): ParseResult {
  const st: State = {
    settings: { width: 1280, height: 720, fps: 20, theme: 'light', typingSpeedMs: 50 },
    outputs: [], steps: [], seen: new Set(), sawAction: false, baseDir,
  };
  const errors: TapeError[] = [];
  source.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((text, i) => {
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    parseLine(text, i + 1, st, message => void errors.push({ line: i + 1, message }));
  });
  // Set must precede every action, so steps were counted with the final fps and typing speed.
  const { settings, outputs, steps } = st;
  const totalFrames = steps.reduce((n, s) => n + s.frames, 0);
  const seconds = totalFrames / settings.fps;
  if (!errors.length && totalFrames === 0) errors.push({ line: 1, message: 'Tape produces no frames' });
  if (!errors.length && seconds > MAX_SECONDS) {
    errors.push({ line: 1, message: `Tape is too long: ${seconds.toFixed(2)}s (max ${MAX_SECONDS}s)` });
  }
  return errors.length ? { ok: false, errors } : { ok: true, script: { settings, outputs, steps, totalFrames } };
}

function parseLine(text: string, line: number, st: State, fail: Fail): void {
  let tokens: string[];
  try {
    tokens = tokenize(text);
  } catch (e) {
    return fail((e as Error).message);
  }
  const [name, ...args] = tokens;
  if (!(COMMANDS as readonly string[]).includes(name)) return fail(unknown('command', name, COMMANDS));
  const command = name as Command;
  const isAction = ACTIONS.includes(command);
  if (isAction) {
    const first = !st.sawAction;
    st.sawAction = true;
    if (first && command !== 'Goto') return fail('The first action command must be Goto');
  } else if (command !== 'Output' && st.sawAction) {
    return fail(`${command} must come before the first action command`);
  }
  const [min, max] = ARITY[command];
  if (args.length < min || args.length > max) return fail(`Wrong number of arguments. Usage: ${USAGE[command]}`);
  if (!isAction) return parseSetup(command, args, line, st, fail);
  const step = parseAction(command, args, line, st.settings, fail);
  if (step) st.steps.push(step);
}

function parseSetup(command: Command, args: string[], line: number, st: State, fail: Fail): void {
  const [a, b] = args;
  if (command === 'Output') {
    const format = formatOf(a);
    if (!format) return fail('Output must end with .gif, .webm or .mp4');
    const key = destinationKey(a, st.baseDir);
    if (st.outputs.some(o => destinationKey(o.path, st.baseDir) === key)) return fail(`Duplicate Output "${a}"`);
    st.outputs.push({ path: a, format, line });
    return;
  }
  if (command === 'Set' && !(SETTINGS as readonly string[]).includes(a)) return fail(unknown('setting', a, SETTINGS));
  const key = command === 'Set' ? `Set ${a}` : command;
  if (st.seen.has(key)) return fail(`${key} can only be set once`);
  st.seen.add(key);
  if (command === 'Viewport') {
    const okWidth = isEven(a, 320, 1920), okHeight = isEven(b, 200, 1080);
    if (!okWidth) fail('Viewport width must be an even integer from 320 to 1920');
    if (!okHeight) fail('Viewport height must be an even integer from 200 to 1080');
    if (okWidth && okHeight) st.settings = { ...st.settings, width: +a, height: +b };
  } else if (a === 'Framerate') {
    if (!isInt(b, 1, 50)) return fail('Framerate must be an integer from 1 to 50');
    st.settings = { ...st.settings, fps: +b };
  } else if (a === 'Theme') {
    if (!THEMES.includes(b)) return fail('Theme must be light, dark or none');
    st.settings = { ...st.settings, theme: b as Theme };
  } else {
    const ms = durationOf(b, fail);
    if (ms === undefined) return;
    if (ms < 10 || ms > 1000) return fail('TypingSpeed must be from 10ms to 1s');
    st.settings = { ...st.settings, typingSpeedMs: ms };
  }
}

function parseAction(command: Command, args: string[], line: number, settings: Settings, fail: Fail): Step | undefined {
  const frames = (ms: number) => framesFor(ms, settings.fps);
  const [arg] = args;
  switch (command) {
    case 'Goto': return { kind: 'Goto', line, frames: 0, url: arg };
    case 'Click': return { kind: 'Click', line, frames: frames(CLICK_MS), selector: arg };
    case 'Press': return { kind: 'Press', line, frames: frames(PRESS_MS), key: arg };
    case 'Type':
      if (!arg) return fail('Type text must not be empty');
      return { kind: 'Type', line, frames: frames([...arg].length * settings.typingSpeedMs), text: arg };
    case 'Wait': {
      const timeoutMs = args.length > 1 ? durationOf(args[1], fail) : WAIT_DEFAULT_MS;
      if (timeoutMs === undefined) return;
      if (timeoutMs < 100 || timeoutMs > 60_000) return fail('Wait timeout must be from 100ms to 60s');
      return { kind: 'Wait', line, frames: 0, selector: arg, timeoutMs };
    }
    case 'Sleep': {
      const ms = durationOf(arg, fail);
      if (ms === undefined) return;
      if (ms <= 0 || ms > 60_000) return fail('Sleep duration must be greater than 0 and at most 60s');
      return { kind: 'Sleep', line, frames: frames(ms) };
    }
    case 'Scroll': {
      // A trailing duration is the duration; what is left is [selector] <pixels>.
      const tail = parseDuration(args[args.length - 1]);
      const rest = tail === undefined ? args : args.slice(0, -1);
      if (rest.length < 1 || rest.length > 2) return fail(`Wrong number of arguments. Usage: ${USAGE.Scroll}`);
      const pixels = rest[rest.length - 1], ms = tail ?? SCROLL_DEFAULT_MS;
      if (!isInt(pixels, -100_000, 100_000) || +pixels === 0) {
        return fail('Scroll pixels must be a non-zero integer from -100000 to 100000');
      }
      if (ms <= 0 || ms > 60_000) return fail('Scroll duration must be greater than 0 and at most 60s');
      return { kind: 'Scroll', line, frames: frames(ms), selector: rest.length === 2 ? rest[0] : null, pixels: +pixels };
    }
  }
}
