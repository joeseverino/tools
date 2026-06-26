#!/usr/bin/env node
// validate-json <schema.json> — read a JSON document on stdin and validate it
// against the named JSON Schema (Ajv 2020). The ONE validator for every fleet
// *data* contract (repos --json, brief --json, …): add a schema under schemas/,
// point this at it, assert it in a contract test — no second Ajv wiring per
// tool. (validate-describe.mjs stays specialized for the cordon command-surface
// contract + its prose lint; this is the generic data-contract counterpart.)
//
// Exits 0 + "valid: <schema>" on success; 1 with one diagnostic per error on a
// schema violation or bad JSON; 2 on usage error. So a contract test is one line
// in any language: `<tool> --json | validate-json schemas/<tool>.schema.json`.
import fs from 'node:fs';
import process from 'node:process';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaPath = process.argv[2];
if (!schemaPath) {
  console.error('usage: <document.json> | validate-json <schema.json>');
  process.exit(2);
}

let schema;
try {
  schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
} catch (error) {
  console.error(`cannot read schema ${schemaPath}: ${error.message}`);
  process.exit(2);
}
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

let input = '';
for await (const chunk of process.stdin) input += chunk;

let document;
try {
  document = JSON.parse(input);
} catch (error) {
  console.error(`invalid JSON: ${error.message}`);
  process.exit(1);
}

if (!validate(document)) {
  for (const error of validate.errors || []) {
    console.error(`${error.instancePath || '/'} ${error.message}`);
  }
  process.exit(1);
}
console.log(`valid: ${schemaPath.split('/').pop()}`);
