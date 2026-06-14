#!/usr/bin/env node
// doc-to-pdf <input.md> [output.pdf]
// Render a Markdown file to PDF with fully-rendered Mermaid diagrams. Offline:
// Markdown via markdown-it, Mermaid from the locally-pinned bundle, and the
// local Chromium as the print engine (no LaTeX or runtime download).
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

function readRequired(file, label) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    die(`${label} not found: ${file}`);
  }
}

function cssString(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\A ');
}

function svgDataUrl(svg) {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function htmlText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function playwrightChromiumCandidates() {
  const cache = path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!fs.existsSync(cache)) return [];

  return fs.readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^chromium(?:_headless_shell)?-\d+$/.test(entry.name))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
    .flatMap((entry) => {
      const root = path.join(cache, entry.name);
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((child) => child.isDirectory())
        .flatMap((child) => {
          const platform = path.join(root, child.name);
          return [
            path.join(platform, 'chrome-headless-shell'),
            path.join(
              platform,
              'Google Chrome for Testing.app',
              'Contents',
              'MacOS',
              'Google Chrome for Testing',
            ),
          ];
        });
    });
}

// Emit-once command surface (the .mjs leg of the cross-repo `describe`
// contract). Both --help and --describe render from this one object, so the
// human view and the machine JSON can't drift. Shape matches lib/describe.sh
// and `severino-vault-mcp describe`.
const SPEC = {
  ok: true,
  schema_version: 4,
  name: 'doc-to-pdf',
  description: 'Render a Markdown file (with Mermaid) to PDF via local Chromium, offline.',
  group: 'Authoring',
  order: 170,
  effect: 'local_write',
  global_options: [],
  paras: [
    'Produces a branded document using the Joe Severino kit. The kit resolves from DOCTOPDF_BRAND_KIT, then BRAND_HOME, then CODE_HOME/Assets/severino-brand.',
  ],
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
const sourceName = path.basename(input);
const sourceTitle = path.basename(input, path.extname(input));

const codeHome = process.env.CODE_HOME || path.join(os.homedir(), 'Documents', 'Code');
const brandHome = process.env.BRAND_HOME || path.join(codeHome, 'Assets', 'severino-brand');
const brandKit = path.resolve(
  process.env.DOCTOPDF_BRAND_KIT
    || path.join(brandHome, 'kits', 'joe-severino'),
);
const brandTokens = readRequired(path.join(brandKit, 'web', 'tokens.css'), 'brand tokens');
const brandMark = readRequired(path.join(brandKit, 'mark', 'mark.svg'), 'brand mark');
const brandWordmark = readRequired(
  path.join(brandKit, 'wordmark', 'wordmark-caps.svg'),
  'brand wordmark',
);
const wordmarkUrl = svgDataUrl(brandWordmark);

// Locate a headless-capable Chromium. Prefer the explicit override and
// Chromium-native installs before falling back to branded browsers.
const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ...playwrightChromiumCandidates(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
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
const titleMatch = body.match(/<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/);
const titleContent = titleMatch?.[1] || htmlText(sourceTitle);
const brandedTitle = `<h1 class="document-title"><span class="document-mark">${brandMark}</span><span>${titleContent}</span></h1>`;
body = titleMatch
  ? body.replace(titleMatch[0], brandedTitle)
  : `${brandedTitle}\n${body}`;

// Relative image paths (`![](./photos/x.png)`) must resolve against the input
// Markdown's directory, not the temp HTML in os.tmpdir() — otherwise Chrome
// can't find them and renders an empty <img> (the "big gap"). A <base> pointing
// at the input dir fixes every relative reference at once.
const baseHref = `${pathToFileURL(path.dirname(input)).href}/`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${htmlText(sourceTitle)}</title>
<base href="${baseHref}">
<style>
  ${brandTokens}
  @page {
    margin: 18mm 16mm 22mm;
    @bottom-left {
      content: "";
      background: url("${wordmarkUrl}") left center / 19mm auto no-repeat;
    }
    @bottom-center {
      content: "${cssString(sourceName)}";
      color: color-mix(in srgb, var(--brand-ink) 58%, var(--brand-paper));
      font: 8px/1.2 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    @bottom-right {
      content: counter(page) " / " counter(pages);
      color: color-mix(in srgb, var(--brand-ink) 58%, var(--brand-paper));
      font: 8px/1.2 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
  }
  body { font: 15px/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: var(--brand-ink); background: var(--brand-paper); max-width: 820px; margin: 0 auto; }
  h1 { font-size: 28px; border-bottom: 2px solid var(--brand-accent); padding-bottom: .25em; }
  h1.document-title { display: flex; align-items: center; gap: 12px; }
  .document-mark { display: inline-flex; flex: 0 0 auto; width: 34px; height: 34px; }
  .document-mark svg { display: block; width: 100%; height: 100%; }
  h2 { font-size: 21px; margin-top: 1.6em; border-bottom: 1px solid color-mix(in srgb, var(--brand-ink) 18%, var(--brand-paper)); padding-bottom: .2em; page-break-after: avoid; }
  h3 { font-size: 17px; margin-top: 1.3em; page-break-after: avoid; }
  a { color: var(--brand-accent); text-decoration: none; }
  code { font: 13px/1.4 "SF Mono", Menlo, Consolas, monospace; background: color-mix(in srgb, var(--brand-accent) 7%, var(--brand-paper)); padding: .1em .35em; border-radius: 4px; }
  pre { background: color-mix(in srgb, var(--brand-accent) 5%, var(--brand-paper)); padding: 12px 14px; border-radius: 6px; overflow-wrap: anywhere; white-space: pre-wrap; }
  pre code { background: none; padding: 0; font-size: 11px; }
  img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 13px; }
  th, td { border: 1px solid color-mix(in srgb, var(--brand-ink) 20%, var(--brand-paper)); padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: color-mix(in srgb, var(--brand-accent) 7%, var(--brand-paper)); }
  pre.mermaid { background: none; padding: 8px 0; text-align: center; page-break-inside: avoid; }
  pre.mermaid svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
  pre.mermaid .node rect,
  pre.mermaid .node polygon,
  pre.mermaid .cluster rect { rx: 6px; ry: 6px; }
  pre.mermaid .edgeLabel { color: var(--brand-ink); }
</style></head>
<body><main>${body}</main>
<script>${fs.readFileSync(mermaidBundle, 'utf8')}</script>
<script>
  const brandStyles = getComputedStyle(document.documentElement);
  const brandColor = (name) => brandStyles.getPropertyValue(name).trim();
  const rgb = (value) => {
    const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const expanded = hex[1].length === 3
        ? [...hex[1]].map((digit) => digit + digit).join('')
        : hex[1];
      return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16));
    }
    const channels = value.match(/^rgb\\(\\s*(\\d+)\\D+(\\d+)\\D+(\\d+)/i);
    if (channels) return channels.slice(1).map(Number);
    throw new Error('Unsupported brand color token: ' + value);
  };
  const hex = (channels) => '#' + channels
    .map((channel) => Math.round(channel).toString(16).padStart(2, '0'))
    .join('');
  const mix = (foreground, background, amount) => {
    const front = rgb(foreground);
    const back = rgb(background);
    const weight = amount / 100;
    return hex(front.map((channel, index) => channel * weight + back[index] * (1 - weight)));
  };
  const accent = brandColor('--brand-accent');
  const ink = brandColor('--brand-ink');
  const paper = brandColor('--brand-paper');
  const tint = (amount) => mix(accent, paper, amount);

  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    flowchart: {
      curve: 'basis',
      nodeSpacing: 42,
      rankSpacing: 52,
      padding: 14,
    },
    themeVariables: {
      fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      fontSize: '15px',
      primaryColor: tint(7),
      primaryBorderColor: accent,
      primaryTextColor: ink,
      secondaryColor: tint(3),
      secondaryBorderColor: accent,
      secondaryTextColor: ink,
      tertiaryColor: paper,
      tertiaryBorderColor: tint(34),
      tertiaryTextColor: ink,
      lineColor: tint(72),
      textColor: ink,
      edgeLabelBackground: paper,
      clusterBkg: tint(3),
      clusterBorder: tint(34),
      titleColor: ink,
    },
  });
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
