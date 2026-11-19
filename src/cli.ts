#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decodeTape, formatOf, parseTape } from './tape';

const USAGE = `Usage:
  webtape init [--force]                     Write demo.tape and demo.html to the current directory
  webtape run <file.tape> [-o <path>]...     Record a tape; -o replaces every Output in the tape
  webtape --help | -h
  webtape --version | -v
`;

function main(args: string[]): number {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        force: { type: 'boolean' },
        output: { type: 'string', short: 'o', multiple: true },
      },
    });
  } catch (err) {
    return usageError((err as Error).message);
  }
  if (parsed.values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (parsed.values.version) {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  const [command, ...rest] = parsed.positionals;
  if (command === 'run') {
    if (rest.length !== 1) return usageError(rest.length ? 'run takes exactly one tape file' : 'missing <file.tape>');
    return run(rest[0], parsed.values.output ?? []);
  }
  // init lands in Task 14; until then it shares the bare-usage path.
  if (command !== undefined && command !== 'init') return usageError(`unknown command "${command}"`);
  process.stderr.write(USAGE);
  return 2;
}

function usageError(reason: string): number {
  process.stderr.write(`error: ${reason}\n${USAGE}`);
  return 2;
}

function run(tapeArg: string, outputs: string[]): number {
  const bad = outputs.find(o => !formatOf(o));
  if (bad !== undefined) return usageError(`unsupported output "${bad}" (use .gif, .webm or .mp4)`);
  let source: string;
  try {
    source = decodeTape(readFileSync(tapeArg));
  } catch (err) {
    process.stderr.write(`Cannot read ${tapeArg}: ${(err as Error).message}\n`);
    return 1;
  }
  const result = parseTape(source);
  if (!result.ok) {
    process.stderr.write(result.errors.map(e => `${tapeArg}:${e.line}: ${e.message}\n`).join(''));
    return 1;
  }
  const { totalFrames, settings: { fps } } = result.script;
  process.stderr.write(`Recording ${tapeArg} -> ${totalFrames} frames (${(totalFrames / fps).toFixed(2)}s @ ${fps} fps)\n`);
  // Task 7 replaces this with the real recording.
  process.stderr.write('Recording is not implemented yet\n');
  return 1;
}

process.exitCode = main(process.argv.slice(2));
