import { deriveProjections } from './contracts.mjs';

function main() {
  const args = process.argv.slice(2);
  let id = null;
  let all = false;
  let go = false;
  let json = false;
  let scope = 'local';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--all') all = true;
    else if (arg === '--go') go = true;
    else if (arg === '--json') json = true;
    else if (arg === '--scope' && args[index + 1]) scope = args[++index];
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else if (!id) id = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
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
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 2;
}
