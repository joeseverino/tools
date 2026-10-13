// Shared HTML → PDF rendering commons for the document tools (doc-to-pdf,
// external consumers via TOOLS_HOME). Owns Chromium discovery, the
// print-to-PDF step, data-URL/escaping helpers, and the vendored fallback
// fonts under lib/pdf-engine/fonts/. Pure functions — no CLI, no process.exit;
// callers translate thrown Errors into their own error surface.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const engineHome = import.meta.dirname;

export function cssString(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\A ');
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function fileDataUrl(file: string, mediaType: string): string {
  return `data:${mediaType};base64,${fs.readFileSync(file).toString('base64')}`;
}

export function htmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function playwrightChromiumCandidates(): string[] {
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

// Locate a headless-capable Chromium. Prefer the explicit override and
// Chromium-native installs before falling back to branded browsers.
export function findChromium(explicitPath?: string): string | null {
  return [
    explicitPath,
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ...playwrightChromiumCandidates(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].find((p) => p && fs.existsSync(p)) || null;
}

export function vendoredFont(name: string): string {
  return path.join(engineHome, 'fonts', name);
}

export interface PrintHtmlToPdfOptions {
  chrome: string;
  html: string;
  output: string;
  tmpPrefix?: string;
  keepHtml?: boolean;
  onKeepHtml?: (tmpHtml: string) => void;
}

export function printHtmlToPdf({ chrome, html, output, tmpPrefix = 'pdf-engine', keepHtml = false, onKeepHtml }: PrintHtmlToPdfOptions): void {
  const tmpHtml = path.join(os.tmpdir(), `${tmpPrefix}-${process.pid}.html`);
  fs.writeFileSync(tmpHtml, html);
  if (keepHtml && onKeepHtml) onKeepHtml(tmpHtml);

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
      throw new Error(`Chrome failed to produce the PDF.\n${result.stderr || result.stdout || ''}`);
    }
  } finally {
    if (!keepHtml) fs.rmSync(tmpHtml, { force: true });
  }
}
