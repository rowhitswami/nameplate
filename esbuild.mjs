// Bundles the extension into a single CommonJS file for the VS Code extension host.
import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const problemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      }
      console.log('[watch] build finished');
    });
  },
};

const ctx = await esbuild.context({
  // extension.js: the extension; git-clean-filter.js: the program Git runs (see src/gitFilter).
  entryPoints: {
    extension: 'src/extension.ts',
    'git-clean-filter': 'src/gitFilter/cleanFilter.ts',
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  // Prefer ES module builds: jsonc-parser's default UMD build loads its parts
  // with dynamic require() calls that a bundle cannot resolve.
  mainFields: ['module', 'main'],
  outdir: 'dist',
  external: ['vscode'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'silent',
  plugins: [problemMatcherPlugin],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
