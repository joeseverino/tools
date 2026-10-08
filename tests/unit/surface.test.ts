import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderSurface } from 'cordon-spec/emit';
import type { SurfaceSpec as CordonSpec } from 'cordon-spec/emit';
import { renderContract, serializeContract } from '../../lib/sdk/surface.ts';
import type { ToolSpec } from '../../lib/sdk/surface.ts';
import { renderUsage, renderUsageFor } from '../../lib/sdk/usage.ts';

const demo: ToolSpec = {
  name: 'demo',
  description: 'A demo tool.',
  group: 'Test',
  order: 10,
  effect: 'read',
  synopsis: ['demo [options] <file>...'],
  paras: ['First paragraph.'],
  examples: [{ command: 'demo a.txt', comment: 'the common case' }],
  options: [
    { flags: ['-c', '--copy'], help: 'Keep the original' },
    { flags: ['-k', '--key'], metavar: 'PATH', repeatable: true, help: 'Add a key (repeatable)' },
    { flags: ['--filter'], choices: ['all', 'published', 'draft'], help: 'Which items' },
  ],
  positionals: [{ name: 'file', variadic: true, help: 'File(s) to act on' }],
  env: [{ name: 'DEMO_HOME', help: 'Where demo lives' }],
  commands: [
    {
      name: 'run',
      summary: 'Run it',
      effect: 'vault_write',
      network: true,
      paras: ['Detail about the run command.'],
      examples: [{ command: 'demo run thing', comment: 'a run example' }],
      delegates: 'the owning repo (see its README)',
      options: [{ flags: ['--fast'], help: 'Run faster' }],
      positionals: [{ name: 'target', help: 'What to run' }],
    },
  ],
};

test('the contract carries the versioned envelope and scoped signals', () => {
  const contract = renderContract(demo);
  assert.equal(contract.schema_version, 4);
  assert.deepEqual(contract.global_options.map((option) => option.name), ['--copy', '--key', '--filter']);
  const key = contract.global_options[1];
  assert.deepEqual(key?.flags, ['-k', '--key']);
  assert.equal(key?.takes_value, true);
  assert.equal(key?.repeatable, true);
  assert.equal(contract.global_options[0]?.takes_value, false);
  assert.ok(!('repeatable' in (contract.global_options[0] ?? {})));
  const run = contract.commands[0];
  assert.equal(run?.effect, 'vault_write');
  assert.equal(run?.network, true);
  assert.ok(!('interactive' in (run ?? {})));
  assert.equal(run?.delegates, 'the owning repo (see its README)');
  assert.deepEqual(run?.args.map((arg) => arg.name), ['target', '--fast']);
});

test('keys are emitted in the documented order', () => {
  const text = serializeContract(renderContract(demo), false);
  const keys = Object.keys(JSON.parse(text) as object);
  assert.deepEqual(keys, ['ok', 'schema_version', 'name', 'description', 'group', 'order', 'effect', 'global_options', 'positionals', 'paras', 'examples', 'commands']);
  assert.ok(text.endsWith('}\n'));
  const run = (JSON.parse(text) as { commands: Record<string, unknown>[] }).commands[0] ?? {};
  assert.deepEqual(Object.keys(run), ['name', 'summary', 'args', 'effect', 'network', 'paras', 'examples', 'delegates']);
});

test('pretty output is indented four spaces', () => {
  assert.match(serializeContract(renderContract(demo), true), /\n {4}"ok": true,/);
});

test('contract matches cordon-spec renderSurface structurally', () => {
  const cordon: CordonSpec = {
    name: demo.name,
    group: demo.group,
    order: demo.order,
    description: demo.description,
    effect: 'read',
    paras: demo.paras ?? [],
    examples: [['demo a.txt', 'the common case']],
    options: [
      { flags: ['-c', '--copy'], help: 'Keep the original' },
      { flags: ['-k', '--key'], metavar: 'PATH', takesValue: true, repeatable: true, help: 'Add a key (repeatable)' },
      { flags: ['--filter'], choices: ['all', 'published', 'draft'], takesValue: true, help: 'Which items' },
    ],
    positionals: [{ name: 'file', variadic: true, help: 'File(s) to act on' }],
    commands: [
      {
        name: 'run',
        summary: 'Run it',
        effect: 'vault_write',
        network: true,
        paras: ['Detail about the run command.'],
        examples: [['demo run thing', 'a run example']],
        delegates: 'the owning repo (see its README)',
        options: [{ flags: ['--fast'], help: 'Run faster' }],
        positionals: [{ name: 'target', help: 'What to run' }],
      },
    ],
  };
  assert.deepEqual(renderContract(demo), renderSurface(cordon));
});

test('main usage lists commands and points at focused help without inlining command detail', () => {
  const text = renderUsage(demo, 80);
  assert.match(text, /^Usage: demo \[options\] <file>\.\.\.\n/);
  assert.match(text, /\nCommands:\n {2}run {2}Run it\n/);
  assert.match(text, /-c, --copy +Keep the original/);
  assert.match(text, / {4}--filter \{all,published,draft\} +Which items/);
  assert.match(text, /-h, --help +Show this help/);
  assert.match(text, /Run 'demo <command> -h'/);
  assert.match(text, /\nEnvironment:\n {2}DEMO_HOME {2}Where demo lives\n/);
  assert.doesNotMatch(text, /--fast|Detail about the run command/);
});

test('focused usage renders one command and not the tool-level prose', () => {
  const text = renderUsageFor(demo, 'run', 80);
  assert.match(text, /^Usage: demo run \[options\] <target>\n\nRun it\n/);
  assert.match(text, /\nEffect: vault_write · network\n/);
  assert.match(text, /\nFlags are owned elsewhere: the owning repo/);
  assert.match(text, /--fast +Run faster/);
  assert.doesNotMatch(text, /First paragraph|demo a\.txt/);
});

test('an unknown command falls back to the full usage', () => {
  assert.equal(renderUsageFor(demo, 'nope', 80), renderUsage(demo, 80));
});

test('help text wraps at the terminal width with a hanging indent', () => {
  const spec: ToolSpec = {
    ...demo,
    commands: [],
    options: [{ flags: ['--wide'], help: 'one two three four five six seven eight nine ten eleven twelve' }],
  };
  const lines = renderUsage(spec, 40).split('\n');
  const start = lines.findIndex((line) => line.includes('--wide'));
  assert.equal(lines[start], '      --wide  one two three four five');
  assert.equal(lines[start + 1], '              six seven eight nine ten');
});
