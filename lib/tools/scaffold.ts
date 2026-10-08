// `tools new`: the skeleton of a typed tool.
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nextOrder } from './next-order.ts';

export function launcher(name: string): string {
  return `#!/usr/bin/env node\nimport { runTool } from "../lib/sdk/tool.ts";\nimport { tool } from "../lib/${name}/main.ts";\nawait runTool(tool);\n`;
}

export function toolSource(name: string, order: number): string {
  return `import { blank, msg } from '../sdk/output.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: '${name}',
  description: 'One-line description of ${name}.',
  group: 'Other',
  order: ${order},
  // Declare the blast radius explicitly: read | local_write | vault_write | remote_write | deploy,
  // plus network: true for remote reach and interactive: true when a TTY is needed.
  effect: 'read',
  synopsis: ['${name} [options] <args>'],
};

const run: Handler = () => {
  blank();
  msg('green', 'todo', 'implement ${name}');
  blank();
  return 0;
};

export const tool: ToolDefinition = { spec, run };
`;
}

export function agentSource(name: string, order: number): string {
  return `import { resultOk } from '../sdk/result.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import type { Handler, ToolDefinition } from '../sdk/tool.ts';

export const spec: ToolSpec = {
  name: '${name}',
  description: 'One-line description of ${name}.',
  group: 'Other',
  order: ${order},
  effect: 'read',
  synopsis: ['${name} [options]'],
  paras: [
    'Emits the Severino Tools result-v1 envelope so agents and scripts receive stable success, error, warning, receipt, and next-action fields.',
  ],
};

// Replace this payload with domain logic. For a failure, write resultError(code, message) and return 1.
const run: Handler = () => {
  process.stdout.write(resultOk({ message: 'implement ${name}' }));
  return 0;
};

export const tool: ToolDefinition = { spec, run };
`;
}

/** Writes bin/<name> and lib/<name>/main.ts. Returns the next free inventory order used. */
export function scaffold(home: string, name: string, agent: boolean, describeJson: string): number {
  const order = nextOrder(JSON.parse(describeJson));
  const bin = path.join(home, 'bin', name);
  const dir = path.join(home, 'lib', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'main.ts'), agent ? agentSource(name, order) : toolSource(name, order));
  writeFileSync(bin, launcher(name));
  chmodSync(bin, 0o755);
  return order;
}

export function targetExists(home: string, name: string): boolean {
  return existsSync(path.join(home, 'bin', name));
}
