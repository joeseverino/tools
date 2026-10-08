import { accessSync, constants, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CliError, die } from '../sdk/cli.ts';
import { footer, header, msg, palette } from '../sdk/output.ts';
import { toolsHome } from '../sdk/paths.ts';
import { runInherit } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';
import { buildConfig } from './config.ts';
import { browserOptions } from './puppeteer.ts';

export const spec: ToolSpec = {
  name: 'diagram',
  description: 'Render Mermaid .mmd sources to neighboring PNG files.',
  group: 'Authoring',
  order: 180,
  effect: 'local_write',
  synopsis: ['diagram <path>...'],
  paras: [
    'Each path may be an .mmd file or a directory. Directories render their top-level .mmd files.',
    'Rendering uses the Mermaid CLI pinned in package.json and the local Chromium, with Joe Severino brand tokens, PNG output up to 3300px on the long side, and a white background. Set DIAGRAM_BRAND_KIT to override the kit directory.',
    'Author flow diagrams with flowchart TB. Contract diagrams may use HTML labels for dense multiline nodes; site diagrams stay on SVG labels when their nodes are single-line.',
  ],
  positionals: [{ name: 'path', variadic: true, help: 'Mermaid source file or directory' }],
  examples: [{ command: 'diagram docs/diagrams/' }, { command: 'diagram docs/diagrams/architecture.mmd' }],
};

function isDirectory(target: string): boolean {
  return existsSync(target) && statSync(target).isDirectory();
}

function isFile(target: string): boolean {
  return existsSync(target) && statSync(target).isFile();
}

/** Expands each target (an .mmd file or a directory's top-level .mmd files) into sources. */
export function collectSources(targets: readonly string[]): string[] {
  const sources: string[] = [];
  for (const target of targets) {
    if (isDirectory(target)) {
      const found = readdirSync(target)
        .filter((name) => name.endsWith('.mmd'))
        .sort()
        .map((name) => `${target}/${name}`)
        .filter(isFile);
      if (found.length === 0) die('error', `no .mmd files found in: ${target}`);
      sources.push(...found);
    } else if (isFile(target) && target.endsWith('.mmd')) sources.push(target);
    else if (existsSync(target)) die('error', `expected an .mmd file or directory: ${target}`);
    else die('error', `path not found: ${target}`);
  }
  return sources;
}

function writeSupportFiles(dir: string): { config: string; browser: string } {
  const config = path.join(dir, 'config.json');
  const browser = path.join(dir, 'browser.json');
  try {
    writeFileSync(config, `${JSON.stringify(buildConfig(), null, 2)}\n`);
    writeFileSync(browser, `${JSON.stringify(browserOptions())}\n`);
  } catch (error) {
    throw new CliError(`diagram: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
  return { config, browser };
}

const run: Handler = (args, rt) => {
  if (args.length < 1) {
    rt.printUsage();
    return 0;
  }
  const sources = collectSources(args);

  const mmdc = process.env['MMDC_BIN'] || path.join(toolsHome, 'node_modules/.bin/mmdc');
  try {
    accessSync(mmdc, constants.X_OK);
  } catch {
    die('error', `mermaid-cli is not installed; run: npm ci (in ${toolsHome})`);
  }

  const scratch = mkdtempSync(path.join(process.env['TMPDIR'] || tmpdir(), 'diagram-'));
  try {
    const { config, browser } = writeSupportFiles(scratch);
    header('rendering', sources.length);
    const p = palette();
    let failed = 0;
    for (const src of sources) {
      const name = path.basename(src);
      const out = src.replace(/\.mmd$/, '.png');
      const status = runInherit(mmdc, ['-i', name, '-o', name.replace(/\.mmd$/, '.png'), '-c', config, '-p', browser, '--size', '3300', '-b', 'white'], {
        cwd: path.resolve(path.dirname(src)),
      });
      if (status === 0) msg('green', 'rendered', `${src} ${p.DIM}→${p.RESET} ${out}`);
      else {
        msg('red', 'failed', src);
        failed += 1;
      }
    }
    footer('rendered', sources.length - failed, 0, failed);
    return failed === 0 ? 0 : 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
};

export const tool: ToolDefinition = { spec, run };
