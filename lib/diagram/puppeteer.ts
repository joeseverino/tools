// Puppeteer launch options for mmdc: the local Chromium doc-to-pdf prints with,
// so rendering needs no browser download and no network.
import { findChromium } from '../pdf-engine/index.ts';

const executablePath = findChromium(process.env['DIAGRAM_CHROMIUM']);
if (executablePath) {
  process.stdout.write(JSON.stringify({ executablePath, headless: 'shell' }) + '\n');
} else {
  console.error('diagram: no Chromium, Chrome, or Edge found (set DIAGRAM_CHROMIUM)');
  process.exitCode = 1;
}
