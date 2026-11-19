import * as esbuild from 'esbuild';

const builds = [
  { entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'external' },
];

if (process.argv.includes('--watch')) {
  for (const cfg of builds) await (await esbuild.context(cfg)).watch();
} else {
  await Promise.all(builds.map((cfg) => esbuild.build(cfg)));
}
