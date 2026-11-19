#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

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
    process.stderr.write(`${(err as Error).message}\n${USAGE}`);
    return 2;
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
  process.stderr.write(USAGE);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
