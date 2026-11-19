#!/usr/bin/env node
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Browser } from 'playwright';
import { launchBrowser, recordScript, StepError } from './record';
import { formatBytes, outputSize } from './shared';
import { openStudio, writeOutputs } from './studio';
import { decodeTape, destinationKey, formatOf, parseTape } from './tape';

const USAGE = `Usage:
  webtape init [--force]                     Write demo.tape and demo.html to the current directory
  webtape run <file.tape> [-o <path>]...     Record a tape; -o replaces every Output in the tape
  webtape --help | -h
  webtape --version | -v
`;

async function main(args: string[]): Promise<number> {
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
  if (command === 'init') {
    if (rest.length) return usageError('init takes no arguments');
    return init(parsed.values.force ?? false);
  }
  if (command !== undefined) return usageError(`unknown command "${command}"`);
  process.stderr.write(USAGE);
  return 2;
}

const DEMO_FILES = ['demo.tape', 'demo.html'];

function init(force: boolean): number {
  const existing = force ? undefined : DEMO_FILES.find(f => existsSync(f));
  if (existing) {
    process.stderr.write(`${existing} already exists (use --force to overwrite)\n`);
    return 1;
  }
  try {
    for (const f of DEMO_FILES) {
      copyFileSync(new URL(`../templates/${f}`, import.meta.url), f);
      process.stdout.write(`Created ${f}\n`);
    }
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    return 1;
  }
  process.stdout.write('Next: webtape run demo.tape\n');
  return 0;
}

function usageError(reason: string): number {
  process.stderr.write(`error: ${reason}\n${USAGE}`);
  return 2;
}

async function run(tapeArg: string, outputs: string[]): Promise<number> {
  const bad = outputs.find(o => !formatOf(o));
  if (bad !== undefined) return usageError(`unsupported output "${bad}" (use .gif, .webm or .mp4)`);
  const cwd = process.cwd();
  const keys = outputs.map(o => destinationKey(o, cwd));
  const dup = keys.findIndex((k, i) => keys.indexOf(k) !== i);
  if (dup >= 0) return usageError(`duplicate -o "${outputs[dup]}" (same file as an earlier -o)`);
  let source: string;
  try {
    source = decodeTape(readFileSync(tapeArg));
  } catch (err) {
    process.stderr.write(`Cannot read ${tapeArg}: ${(err as Error).message}\n`);
    return 1;
  }
  const tapeDir = dirname(resolve(tapeArg));
  const result = parseTape(source, tapeDir);
  if (!result.ok) {
    process.stderr.write(result.errors.map(e => `${tapeArg}:${e.line}: ${e.message}\n`).join(''));
    return 1;
  }
  const { script } = result;
  const { totalFrames, settings: { width, height, fps, theme } } = script;
  const seconds = (totalFrames / fps).toFixed(2);
  process.stderr.write(`Recording ${tapeArg} -> ${totalFrames} frames (${seconds}s @ ${fps} fps)\n`);
  const paths = outputs.length ? outputs.map(o => resolve(cwd, o))
    : script.outputs.length ? script.outputs.map(o => resolve(tapeDir, o.path))
    : [join(tapeDir, basename(tapeArg, extname(tapeArg)) + '.gif')];
  let browser: Browser | undefined;
  try {
    browser = await launchBrowser();
    const studio = await openStudio(browser, { width, height, fps, theme, outputs: paths.map(path => ({ path, format: formatOf(path)! })) });
    await recordScript(browser, script, tapeDir, studio);
    const files = await studio.finish();
    writeOutputs(files);
    const size = outputSize(width, height, theme);
    for (const f of files) {
      process.stdout.write(`Wrote ${displayPath(cwd, f.path)} (${size.width}x${size.height}, ${totalFrames} frames, ${seconds}s, ${formatBytes(f.bytes.length)})\n`);
    }
    return 0;
  } catch (err) {
    process.stderr.write(err instanceof StepError ? `${tapeArg}:${err.line}: ${err.message}\n` : `${(err as Error).message}\n`);
    return 1;
  } finally {
    await browser?.close();
  }
}

function displayPath(cwd: string, abs: string): string {
  const rel = relative(cwd, abs);
  return rel.startsWith('..') || isAbsolute(rel) ? abs : rel;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; });
