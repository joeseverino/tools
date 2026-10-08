import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildConfig, mix, rgb, token } from '../../lib/diagram/config.ts';
import { collectSources } from '../../lib/diagram/main.ts';

const css = ':root { --brand-accent: #123456; --brand-deep: #0a1a2b; --brand-on-accent: #fff; --brand-ink: #111111; --brand-paper: #ffffff; }';

test('token reads a hex custom property and rejects a missing one', () => {
  assert.equal(token(css, 'brand-accent'), '#123456');
  assert.throws(() => token(css, 'brand-missing'), /brand token --brand-missing not found/);
});

test('rgb expands short hex and mix blends toward the background', () => {
  assert.deepEqual(rgb('#fff'), [255, 255, 255]);
  assert.deepEqual(rgb('#123456'), [0x12, 0x34, 0x56]);
  assert.equal(mix('#000000', '#ffffff', 50), '#808080');
  assert.equal(mix('#123456', '#ffffff', 100), '#123456');
});

test('buildConfig themes from the kit tokens and embeds the font', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'diagram-unit-'));
  mkdirSync(path.join(root, 'web'));
  writeFileSync(path.join(root, 'web', 'tokens.css'), css);
  writeFileSync(path.join(root, 'font.woff2'), 'fake');
  const config = buildConfig({ DIAGRAM_BRAND_KIT: root, DIAGRAM_FONT: path.join(root, 'font.woff2') });
  const text = JSON.stringify(config);
  assert.match(text, /"primaryBorderColor":"#123456"/);
  assert.match(text, /"theme":"base"/);
  assert.match(text, new RegExp(Buffer.from('fake').toString('base64')));
});

test('buildConfig names the missing brand tokens file', () => {
  assert.throws(() => buildConfig({ DIAGRAM_BRAND_KIT: '/nonexistent-kit' }), /brand tokens not found: \/nonexistent-kit\/web\/tokens\.css/);
});

test('collectSources expands directories to their top-level .mmd files, sorted', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'diagram-src-'));
  writeFileSync(path.join(root, 'b.mmd'), '');
  writeFileSync(path.join(root, 'a.mmd'), '');
  writeFileSync(path.join(root, 'note.md'), '');
  assert.deepEqual(collectSources([root]), [`${root}/a.mmd`, `${root}/b.mmd`]);
  assert.deepEqual(collectSources([`${root}/b.mmd`]), [`${root}/b.mmd`]);
  assert.throws(() => collectSources([`${root}/note.md`]), /expected an \.mmd file or directory/);
  assert.throws(() => collectSources([`${root}/gone.mmd`]), /path not found/);
});
