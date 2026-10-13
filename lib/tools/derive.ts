import { parseArgs } from 'node:util';
import { reportError } from '../sdk/cli.ts';
import { deriveProjections } from './contracts.ts';

function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      all: { type: 'boolean', default: false },
      go: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      scope: { type: 'string', default: 'local' },
    },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length > 1) throw new Error(`unexpected argument: ${positionals[1]}`);
  const { all, go, json, scope } = values;
  const id = positionals[0] ?? null;
  if (id && all) throw new Error('name one projection or pass --all, not both');
  const result = deriveProjections({ id, all, scope, go });
  if (json) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    process.stdout.write('\n  derive     contract projections\n\n');
    for (const item of result.results) {
      process.stdout.write(`  ${item.status.padEnd(10)} ${item.id}\n    ${item.invocation}${item.detail ? `\n    ${item.detail}` : ''}\n`);
    }
    if (!go && result.results.length) process.stdout.write('\n  dry-run    re-run with --go to write\n');
    process.stdout.write('\n');
  }
  if (!result.ok) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  reportError(error, 2);
}
