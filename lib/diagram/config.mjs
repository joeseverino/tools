#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function die(message) {
  console.error(`diagram: ${message}`);
  process.exit(1);
}

function token(css, name) {
  const match = css.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{3,8})\\s*;`, 'i'));
  if (!match) die(`brand token --${name} not found`);
  return match[1];
}

function rgb(value) {
  const digits = value.slice(1);
  const expanded = digits.length === 3
    ? [...digits].map((digit) => digit + digit).join('')
    : digits.slice(0, 6);
  return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16));
}

function mix(foreground, background, amount) {
  const front = rgb(foreground);
  const back = rgb(background);
  const weight = amount / 100;
  return `#${front
    .map((channel, index) => Math.round(channel * weight + back[index] * (1 - weight)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

const codeHome = process.env.CODE_HOME || path.join(os.homedir(), 'Documents', 'Code');
const brandHome = process.env.BRAND_HOME || path.join(codeHome, 'Assets', 'severino-brand');
const brandKit = path.resolve(
  process.env.DIAGRAM_BRAND_KIT
    || path.join(brandHome, 'kits', 'joe-severino'),
);
const brandFont = path.resolve(
  process.env.DIAGRAM_FONT
    || path.join(brandHome, 'brand', 'fonts', 'inter', 'inter-variable-latin.woff2'),
);
const tokensPath = path.join(brandKit, 'web', 'tokens.css');

let css;
try {
  css = fs.readFileSync(tokensPath, 'utf8');
} catch {
  die(`brand tokens not found: ${tokensPath}`);
}

const accent = token(css, 'brand-accent');
const ink = token(css, 'brand-ink');
const paper = token(css, 'brand-paper');
const cluster = mix(accent, paper, 3);
let fontData;
try {
  fontData = fs.readFileSync(brandFont).toString('base64');
} catch {
  die(`brand font not found: ${brandFont}`);
}

console.log(JSON.stringify({
  theme: 'base',
  themeCSS: [
    `@font-face { font-family: "Inter"; src: url("data:font/woff2;base64,${fontData}") format("woff2"); font-style: normal; font-weight: 100 900; }`,
    '.node rect, .node polygon, .cluster rect { rx: 6px; ry: 6px; }',
    `.edgeLabel p { color: ${ink}; background: ${paper}; border-radius: 3px; padding: 0 4px; }`,
  ].join(' '),
  flowchart: {
    curve: 'basis',
    nodeSpacing: 42,
    rankSpacing: 52,
    padding: 14,
  },
  themeVariables: {
    fontFamily: '"Inter", sans-serif',
    fontSize: '15px',
    primaryColor: mix(accent, paper, 7),
    primaryBorderColor: accent,
    primaryTextColor: ink,
    secondaryColor: mix(accent, paper, 3),
    secondaryBorderColor: accent,
    secondaryTextColor: ink,
    tertiaryColor: paper,
    tertiaryBorderColor: mix(accent, paper, 34),
    tertiaryTextColor: ink,
    lineColor: mix(accent, paper, 72),
    textColor: ink,
    edgeLabelBackground: paper,
    clusterBkg: cluster,
    clusterBorder: mix(accent, paper, 34),
    titleColor: ink,
  },
}, null, 2));
