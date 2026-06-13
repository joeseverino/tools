#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaPath = new URL('../../docs/describe.schema.json', import.meta.url);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

let input = '';
for await (const chunk of process.stdin) input += chunk;

let document;
try {
  document = JSON.parse(input);
} catch (error) {
  console.error(`invalid JSON: ${error.message}`);
  process.exit(1);
}

const contracts = Array.isArray(document.tools) ? document.tools : [document];
let failed = false;

for (const contract of contracts) {
  if (validate(contract)) continue;
  failed = true;
  const name = contract?.name || '(unknown)';
  for (const error of validate.errors || []) {
    console.error(`${name}${error.instancePath || '/'} ${error.message}`);
  }
}

if (failed) process.exit(1);
console.log(`valid describe contracts: ${contracts.length}`);
