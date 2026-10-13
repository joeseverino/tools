import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { definitionDrift, isToolDefinition } from '../../lib/sdk/tool.ts';
import type { ToolDefinition } from '../../lib/sdk/tool.ts';

const root = path.resolve(import.meta.dirname, '../..');

interface Launcher {
  name: string;
  dir: string;
}

function launchers(): Launcher[] {
  const found: Launcher[] = [];
  for (const name of readdirSync(path.join(root, 'bin')).sort()) {
    const text = readFileSync(path.join(root, 'bin', name), 'utf8');
    const match = /import \{ tool \} from "\.\.\/lib\/([^/]+)\/main\.ts";/.exec(text);
    if (match?.[1]) found.push({ name, dir: match[1] });
  }
  return found;
}

async function load(launcher: Launcher): Promise<ToolDefinition> {
  const module: unknown = await import(path.join(root, 'lib', launcher.dir, 'main.ts'));
  const tool = typeof module === 'object' && module !== null && 'tool' in module ? module.tool : undefined;
  assert.ok(isToolDefinition(tool), `${launcher.name}: lib/${launcher.dir}/main.ts must export tool`);
  return tool;
}

function sources(dir: string): string {
  const base = path.join(root, 'lib', dir);
  return readdirSync(base)
    .filter((name) => name.endsWith('.ts') && statSync(path.join(base, name)).isFile())
    .map((name) => readFileSync(path.join(base, name), 'utf8'))
    .join('\n');
}

test('every launcher names a tool whose spec matches the file name', async () => {
  const all = launchers();
  assert.ok(all.length > 0);
  for (const launcher of all) {
    const tool = await load(launcher);
    assert.equal(tool.spec.name, launcher.name);
  }
});

test('spec commands and handlers match for every typed tool, both directions', async () => {
  for (const launcher of launchers()) {
    assert.deepEqual(definitionDrift(await load(launcher)), [], launcher.name);
  }
});

test('inventory orders are unique across the fleet', async () => {
  const orders = new Map<number, string>();
  for (const launcher of launchers()) {
    const { spec } = await load(launcher);
    assert.equal(orders.has(spec.order), false, `${launcher.name} repeats order ${spec.order} of ${orders.get(spec.order)}`);
    orders.set(spec.order, launcher.name);
  }
});

test('every declared long flag is handled in the tool sources, not only declared', async () => {
  for (const launcher of launchers()) {
    const { spec } = await load(launcher);
    const text = sources(launcher.dir);
    const scopes = [spec, ...(spec.commands ?? [])];
    for (const scope of scopes) {
      for (const option of scope.options ?? []) {
        for (const flag of option.flags.filter((candidate) => candidate.startsWith('--'))) {
          const uses = text.split(flag).length - 1;
          assert.ok(uses >= 2, `${launcher.name}: ${flag} is declared but never handled`);
        }
      }
    }
  }
});
