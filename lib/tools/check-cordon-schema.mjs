import fs from 'node:fs';
import path from 'node:path';

const toolsHome = process.env.TOOLS_HOME || path.resolve(import.meta.dirname, '../..');
const canonical = process.env.CORDON_PKG_SCHEMA || path.join(toolsHome, 'node_modules/cordon-spec/schema/cordon-v4.json');
const vendored = path.join(toolsHome, 'schemas/cordon-v4.json');

if (!fs.existsSync(canonical)) {
  process.stderr.write(`pinned Cordon schema unavailable: ${canonical}\n`);
  process.exitCode = 2;
} else if (!fs.readFileSync(canonical).equals(fs.readFileSync(vendored))) {
  process.stderr.write('vendored Cordon schema is stale\n');
  process.exitCode = 1;
} else {
  process.stdout.write('vendored Cordon schema is current\n');
}
