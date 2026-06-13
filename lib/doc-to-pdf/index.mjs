#!/usr/bin/env node
// doc-to-pdf <input.md> [output.pdf]
// Render a Markdown file to PDF with fully-rendered Mermaid diagrams. Offline:
// Markdown via markdown-it, Mermaid from the locally-pinned bundle, and the
// system Google Chrome as the print engine (no LaTeX, no Puppeteer download).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// markdown-it (the one external dep reached at startup) is imported lazily at
// the render site below, so --help / --describe answer without node_modules
// installed — the command-surface contract (and `tools describe` federation)
// must work on a bare checkout.

const require = createRequire(import.meta.url);

function die(msg) {
  console.error(`doc-to-pdf: ${msg}`);
  process.exit(1);
}

// Emit-once command surface (the .mjs leg of the cross-repo `describe`
// contract). Both --help and --describe render from this one object, so the
// human view and the machine JSON can't drift. Shape matches lib/describe.sh
// and `severino-vault-mcp describe`.
const SPEC = {
  ok: true,
  schema_version: 4,
  name: 'doc-to-pdf',
  description: 'Render a Markdown file (with Mermaid) to PDF via the system Chrome, offline.',
  group: 'Authoring',
  order: 170,
  effect: 'local_write',
  global_options: [],
  paras: [],
  examples: [],
  positionals: [
    { name: 'input.md', positional: true, required: true, help: 'Markdown file to render.' },
    { name: 'output.pdf', positional: true, required: false, help: 'Output path (default: <input>.pdf beside the input).' },
  ],
  commands: [],
};

function renderUsage() {
  const pos = SPEC.positionals
    .map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`))
    .join(' ');
  return `Usage: ${SPEC.name} ${pos}\n${SPEC.description}`;
}

const args = process.argv.slice(2).filter((a) => a !== '--');
if (args[0] === '--describe') {
  const pretty = args.includes('--pretty');
  console.log(pretty ? JSON.stringify(SPEC, null, 2) : JSON.stringify(SPEC));
  process.exit(0);
}
if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
  console.log(renderUsage());
  process.exit(args.length === 0 ? 1 : 0);
}

const input = path.resolve(args[0]);
if (!fs.existsSync(input)) die(`input not found: ${input}`);
const output = args[1]
  ? path.resolve(args[1])
  : path.join(path.dirname(input), `${path.basename(input, path.extname(input))}.pdf`);

// Locate a headless-capable Chromium. CHROME_PATH overrides.
const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].find((p) => p && fs.existsSync(p));
if (!chrome) die('no Chrome/Edge/Chromium found. Set CHROME_PATH to a Chromium binary.');

// The single-file Mermaid bundle, inlined so rendering needs no network.
// Resolved by module lookup, so it works wherever node_modules lives (the
// shared toolchain root today, a local install tomorrow).
let mermaidBundle;
try {
  const mermaidDir = path.dirname(require.resolve('mermaid/package.json'));
  mermaidBundle = ['mermaid.min.js', 'mermaid.js']
    .map((f) => path.join(mermaidDir, 'dist', f))
    .find((p) => fs.existsSync(p));
} catch {
  // falls through to the error below
}
if (!mermaidBundle) die('mermaid not found. Run `npm install` in the toolchain root.');

// Pull Mermaid fences out before Markdown rendering and reinsert them raw as
// <pre class="mermaid"> — markdown-it would HTML-escape the arrows and break them.
const raw = fs.readFileSync(input, 'utf8');
const diagrams = [];
const staged = raw.replace(/```mermaid\n([\s\S]*?)```/g, (_, code) => {
  diagrams.push(code.replace(/\s+$/, ''));
  return `\n\nDOCTOPDFMERMAID${diagrams.length - 1}\n\n`;
});

const { default: MarkdownIt } = await import('markdown-it');
const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
let body = md.render(staged);
body = body.replace(/<p>DOCTOPDFMERMAID(\d+)<\/p>/g, (_, i) => `<pre class="mermaid">${diagrams[Number(i)]}</pre>`);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<style>
  @page { margin: 18mm 16mm; }
  body { font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 820px; margin: 0 auto; }
  h1 { font-size: 28px; border-bottom: 2px solid #1E3A8A; padding-bottom: .25em; }
  h2 { font-size: 21px; margin-top: 1.6em; border-bottom: 1px solid #ddd; padding-bottom: .2em; page-break-after: avoid; }
  h3 { font-size: 17px; margin-top: 1.3em; page-break-after: avoid; }
  a { color: #1E3A8A; text-decoration: none; }
  code { font: 13px/1.4 "SF Mono", Menlo, Consolas, monospace; background: #f3f4f6; padding: .1em .35em; border-radius: 4px; }
  pre { background: #f6f8fa; padding: 12px 14px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px; }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f3f4f6; }
  pre.mermaid { background: none; text-align: center; page-break-inside: avoid; }
</style></head>
<body><main>${body}</main>
<script>${fs.readFileSync(mermaidBundle, 'utf8')}</script>
<script>
  mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  mermaid.run().then(() => document.documentElement.setAttribute('data-mermaid-done', '1'));
</script></body></html>`;

const tmpHtml = path.join(os.tmpdir(), `doc-to-pdf-${process.pid}.html`);
fs.writeFileSync(tmpHtml, html);
const keepHtml = !!process.env.DOCTOPDF_KEEP_HTML;
if (keepHtml) console.log(`doc-to-pdf: kept HTML at ${tmpHtml}`);

try {
  const result = spawnSync(chrome, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--virtual-time-budget=30000',
    '--run-all-compositor-stages-before-draw',
    '--no-pdf-header-footer',
    `--print-to-pdf=${output}`,
    pathToFileURL(tmpHtml).href,
  ], { encoding: 'utf8' });
  if (result.status !== 0 || !fs.existsSync(output)) {
    die(`Chrome failed to produce the PDF.\n${result.stderr || result.stdout || ''}`);
  }
  const kb = Math.round(fs.statSync(output).size / 1024);
  console.log(`doc-to-pdf: wrote ${output} (${kb} KB, ${diagrams.length} mermaid diagram${diagrams.length === 1 ? '' : 's'})`);
} finally {
  if (!keepHtml) fs.rmSync(tmpHtml, { force: true });
}
