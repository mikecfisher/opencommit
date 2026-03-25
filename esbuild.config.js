import { build } from 'esbuild';
import fs from 'fs';

// Banner to provide import.meta shims for CJS output
const cjsBanner = `
const __import_meta_url__ = require('url').pathToFileURL(__filename).href;
const __import_meta_filename__ = __filename;
const __import_meta_dirname__ = __dirname;
`;

// Define replacements for import.meta properties
const importMetaDefine = {
  'import.meta.url': '__import_meta_url__',
  'import.meta.filename': '__import_meta_filename__',
  'import.meta.dirname': '__import_meta_dirname__'
};

await build({
  entryPoints: ['./src/cli.ts'],
  bundle: true,
  external: ['@anthropic-ai/claude-agent-sdk'],
  platform: 'node',
  format: 'cjs',
  outfile: './out/cli.cjs',
  banner: { js: cjsBanner },
  define: importMetaDefine
});

await build({
  entryPoints: ['./src/github-action.ts'],
  bundle: true,
  external: ['@anthropic-ai/claude-agent-sdk'],
  platform: 'node',
  format: 'cjs',
  outfile: './out/github-action.cjs',
  banner: { js: cjsBanner },
  define: importMetaDefine
});

const wasmFile = fs.readFileSync(
  './node_modules/@dqbd/tiktoken/lite/tiktoken_bg.wasm'
);

fs.writeFileSync('./out/tiktoken_bg.wasm', wasmFile);
