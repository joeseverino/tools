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

console.log(JSON.stringify({
  theme: 'base',
  themeCSS: [
    '.node rect, .node polygon, .cluster rect { rx: 6px; ry: 6px; }',
    `.edgeLabel { color: ${ink}; }`,
  ].join(' '),
  flowchart: {
    curve: 'basis',
    nodeSpacing: 42,
    rankSpacing: 52,
    padding: 14,
  },
  themeVariables: {
    fontFamily: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
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
    clusterBkg: mix(accent, paper, 3),
    clusterBorder: mix(accent, paper, 34),
    titleColor: ink,
  },
}, null, 2));
