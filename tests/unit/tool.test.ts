import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CliError, SilentExit } from '../../lib/sdk/cli.ts';
import { definitionDrift, runDefinition } from '../../lib/sdk/tool.ts';
import type { ToolDefinition } from '../../lib/sdk/tool.ts';
import type { ToolSpec } from '../../lib/sdk/surface.ts';

const spec: ToolSpec = {
  name: 'gated',
  description: 'A tool with one deploy and one read.',
  group: 'Other',
  order: 990,
  effect: 'read',
  synopsis: ['gated <command>'],
  commands: [
    { name: 'ship', summary: 'Deploy to production', effect: 'deploy', network: true },
    { name: 'look', summary: 'Read something', effect: 'read' },
  ],
};

function definition(log: string[]): ToolDefinition {
  return {
    spec,
    commands: {
      ship: () => (log.push('shipped'), 0),
      look: (args) => (log.push(`looked ${args.join(',')}`), 0),
    },
  };
}

async function capture(def: ToolDefinition, argv: string[]): Promise<{ out: string; error: unknown }> {
  const write = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string | Uint8Array) => ((out += String(chunk)), true)) as typeof process.stdout.write;
  let error: unknown;
  try {
    await runDefinition(def, argv);
  } catch (caught) {
    error = caught;
  } finally {
    process.stdout.write = write;
  }
  return { out, error };
}

test('bare invocation and help render the main screen without running anything', async () => {
  const log: string[] = [];
  for (const argv of [[], ['help'], ['-h'], ['--help']]) {
    const { out } = await capture(definition(log), argv);
    assert.match(out, /^Usage: gated <command>\n/);
  }
  assert.deepEqual(log, []);
});

test('<command> -h renders focused help and never runs the command', async () => {
  const log: string[] = [];
  const { out } = await capture(definition(log), ['ship', '-h']);
  assert.match(out, /^Usage: gated ship \[options\]\n/);
  assert.deepEqual(log, []);
});

test('--describe prints the contract and --pretty indents it', async () => {
  const compact = (await capture(definition([]), ['--describe'])).out;
  assert.equal(JSON.parse(compact).name, 'gated');
  assert.equal(compact.trimEnd().split('\n').length, 1);
  const pretty = (await capture(definition([]), ['--describe', '--pretty'])).out;
  assert.ok(pretty.split('\n').length > 5);
});

test('a deploy command fails closed without a terminal or the bypass', async () => {
  const log: string[] = [];
  delete process.env['TOOLS_ASSUME_YES'];
  const { error } = await capture(definition(log), ['ship']);
  assert.ok(error instanceof CliError);
  assert.equal(error.exitCode, 2);
  assert.match(error.message, /'gated ship' is a deploy .*TOOLS_ASSUME_YES=1/);
  assert.deepEqual(log, []);
});

test('TOOLS_ASSUME_YES and --yes let a deploy run', async () => {
  const log: string[] = [];
  process.env['TOOLS_ASSUME_YES'] = '1';
  try {
    await capture(definition(log), ['ship']);
  } finally {
    delete process.env['TOOLS_ASSUME_YES'];
  }
  await capture(definition(log), ['ship', '--yes']);
  assert.deepEqual(log, ['shipped', 'shipped']);
});

test('a read command is never gated and receives the remaining arguments', async () => {
  const log: string[] = [];
  await capture(definition(log), ['look', 'a', 'b']);
  assert.deepEqual(log, ['looked a,b']);
});

test('an unknown command prints the usage error and exits 2', async () => {
  const { out, error } = await capture(definition([]), ['nope']);
  assert.match(out, /unknown command: nope/);
  assert.match(out, /Usage: gated <command>/);
  assert.ok(error instanceof SilentExit);
  assert.equal(error.exitCode, 2);
});

test('spec commands and handlers must match in both directions', () => {
  assert.deepEqual(definitionDrift(definition([])), []);
  const missing = definitionDrift({ spec, commands: { look: () => 0 } });
  assert.deepEqual(missing, ["gated: command 'ship' has no handler"]);
  const extra = definitionDrift({ spec, commands: { ship: () => 0, look: () => 0, other: () => 0 } });
  assert.deepEqual(extra, ["gated: handler 'other' is not in the spec"]);
});
