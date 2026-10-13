// Puppeteer launch options for mmdc: the local Chromium doc-to-pdf prints with,
// so rendering needs no browser download and no network.
import { findChromium } from '../pdf-engine/index.ts';

export function browserOptions(env: NodeJS.ProcessEnv = process.env): { executablePath: string; headless: string } {
  const executablePath = findChromium(env['DIAGRAM_CHROMIUM']);
  if (!executablePath) throw new Error('no Chromium, Chrome, or Edge found (set DIAGRAM_CHROMIUM)');
  return { executablePath, headless: 'shell' };
}
