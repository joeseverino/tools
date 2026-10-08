#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { codeHome } from '../sdk/paths.ts';

function token(css: string, name: string): string {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{3,8})\\s*;`, 'i'));
  if (!match) throw new Error(`brand token --${name} not found`);
  return match[1] ?? '';
}

function rgb(value: string): number[] {
  const digits = value.slice(1);
  const expanded = digits.length === 3
    ? [...digits].map((digit) => digit + digit).join('')
    : digits.slice(0, 6);
  return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16));
}

function mix(foreground: string, background: string, amount: number): string {
  const front = rgb(foreground);
  const back = rgb(background);
  const weight = amount / 100;
  return `#${front
    .map((channel, index) => Math.round(channel * weight + (back[index] ?? 0) * (1 - weight)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}


const brandHome = process.env['BRAND_HOME'] || path.join(codeHome, 'Assets', 'severino-brand');
const brandKit = path.resolve(
  process.env['DIAGRAM_BRAND_KIT']
    || path.join(brandHome, 'kits', 'joe-severino'),
);
// DIAGRAM_FONT wins and must exist; then the brand kit's font; then the vendored Inter.
const brandKitFont = path.join(brandHome, 'brand', 'fonts', 'inter', 'inter-variable-latin.woff2');
const brandFont = path.resolve(
  process.env['DIAGRAM_FONT']
    || (fs.existsSync(brandKitFont)
      ? brandKitFont
      : path.join(import.meta.dirname, '..', 'pdf-engine', 'fonts', 'inter-variable-latin.woff2')),
);
const tokensPath = path.join(brandKit, 'web', 'tokens.css');

function readOrThrow(file: string, what: string): Buffer {
  try {
    return fs.readFileSync(file);
  } catch {
    throw new Error(`${what} not found: ${file}`);
  }
}

function buildConfig(): object {
  const css = readOrThrow(tokensPath, 'brand tokens').toString('utf8');

  const accent = token(css, 'brand-accent');
  const deep = token(css, 'brand-deep');
  const onAccent = token(css, 'brand-on-accent');
  const ink = token(css, 'brand-ink');
  const paper = token(css, 'brand-paper');
  const cluster = mix(accent, paper, 8);
  const inkRgb = rgb(ink).join(', ');
  const fontData = readOrThrow(brandFont, 'brand font').toString('base64');

  return {
    // Mermaid 12 defaults to ELK and the neo look; keep the dagre layout the diagrams were drawn for.
    layout: 'dagre',
    look: 'classic',
    theme: 'base',
    themeCSS: [
      `@font-face { font-family: "Inter"; src: url("data:font/woff2;base64,${fontData}") format("woff2"); font-style: normal; font-weight: 100 900; }`,
      '.node rect, .node polygon, .cluster rect { rx: 8px; ry: 8px; }',
      `.node rect, .node polygon { filter: drop-shadow(0 1px 3px rgba(${inkRgb}, 0.13)); }`,
      `.node.anchor rect, .node.anchor polygon { fill: ${accent} !important; stroke: ${deep} !important; }`,
      `.node.anchor .nodeLabel, .node.anchor .nodeLabel p, .node.anchor text, .node.anchor tspan { color: ${onAccent} !important; fill: ${onAccent} !important; }`,
      '.cluster-label, .cluster-label p { font-weight: 700; }',
      `.edgeLabel p { color: ${ink}; background: ${paper}; border-radius: 3px; padding: 0 4px; }`,
    ].join(' '),
    flowchart: {
      curve: 'basis',
      wrappingWidth: 260,
      nodeSpacing: 42,
      rankSpacing: 52,
      padding: 14,
    },
    themeVariables: {
      fontFamily: '"Inter", sans-serif',
      fontSize: '15px',
      primaryColor: paper,
      primaryBorderColor: accent,
      primaryTextColor: ink,
      secondaryColor: paper,
      secondaryBorderColor: accent,
      secondaryTextColor: ink,
      tertiaryColor: paper,
      tertiaryBorderColor: mix(accent, paper, 34),
      tertiaryTextColor: ink,
      lineColor: mix(accent, paper, 84),
      textColor: ink,
      edgeLabelBackground: paper,
      clusterBkg: cluster,
      clusterBorder: mix(accent, paper, 45),
      titleColor: ink,
    },
  };
}

try {
  console.log(JSON.stringify(buildConfig(), null, 2));
} catch (error) {
  console.error(`diagram: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
