import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deltaLine, dohMillis, formatFixed, getopts, parseQueryTime, signedFixed, summarize, tableHeader, tableRow } from '../../lib/dns-test/stats.ts';

test('formatFixed rounds the exact binary value, ties to even, like printf', () => {
  assert.equal(formatFixed(12.25, 1), '12.2');
  assert.equal(formatFixed(12.35, 1), '12.3');
  assert.equal(formatFixed(0.5, 0), '0');
  assert.equal(formatFixed(1.5, 0), '2');
  assert.equal(formatFixed(2.5, 0), '2');
  assert.equal(formatFixed(14.75, 1), '14.8');
  assert.equal(formatFixed(3, 1), '3.0');
  assert.equal(formatFixed(0.04, 1), '0.0');
});

test('signedFixed pads with an explicit sign', () => {
  assert.equal(signedFixed(1.5, 7, 1), '   +1.5');
  assert.equal(signedFixed(-12.25, 7, 1), '  -12.2');
  assert.equal(signedFixed(0, 7, 1), '   +0.0');
});

test('parseQueryTime reads the fourth field of the Query time line', () => {
  assert.equal(parseQueryTime(';; Got answer\n;; Query time: 12 msec\n;; SERVER'), '12');
  assert.equal(parseQueryTime('no timing here'), null);
});

test('dohMillis converts curl seconds to whole milliseconds', () => {
  assert.equal(dohMillis('0.045123'), '45');
  assert.equal(dohMillis('0.0125'), '12');
});

test('summarize reports avg, min, p50, p95, max and the success ratio', () => {
  assert.equal(summarize('4', [10, 20, 30, 40]), '25.0 10 20 40 40 4/4');
  assert.equal(summarize('20', [7]), '7.0 7 7 7 7 1/20');
  assert.equal(summarize('5', []), 'N/A N/A N/A N/A N/A 0/5');
});

test('table rows align and mark failed paths', () => {
  assert.equal(tableHeader().split('\n')[1], '-'.repeat(80));
  assert.equal(tableRow('System DNS', '25.0 10 20 40 40 4/4'), 'System DNS               25.0ms     10ms     20ms     40ms     40ms        4/4');
  assert.equal(tableRow('X', 'N/A N/A N/A N/A N/A 0/4'), `${'X'.padEnd(22)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'0/4'.padStart(10)}`);
});

test('deltaLine says slower or faster against the baseline', () => {
  assert.equal(deltaLine('Cloudflare', '30.0', '20.0'), '  Cloudflare               +10.0 ms (slower)');
  assert.equal(deltaLine('Cloudflare', '10.0', '20.0'), '  Cloudflare               -10.0 ms (faster)');
});

test('getopts follows POSIX cluster rules and stops at the first non-option', () => {
  assert.deepEqual(getopts(['-d', 'a.com', '-n5', 'extra', '-a', 'x']), { help: false, domain: 'a.com', runs: '5' });
  assert.deepEqual(getopts(['-h']), { help: true });
  assert.deepEqual(getopts(['--', '-d', 'x']), { help: false });
  assert.deepEqual(getopts(['--foo']), { help: false, error: { kind: 'unknown', option: '-' } });
  assert.deepEqual(getopts(['-d']), { help: false, error: { kind: 'missing', option: 'd' } });
  assert.deepEqual(getopts(['-x']), { help: false, error: { kind: 'unknown', option: 'x' } });
  assert.deepEqual(getopts(['-d', 'a', '-h']), { help: true, domain: 'a' });
});
