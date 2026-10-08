#!/usr/bin/env node
// validate-json <schema.json> — read a JSON document on stdin and validate it
// against the named JSON Schema (Ajv 2020). The ONE validator for every fleet
// *data* contract (repos --json, brief --json, …): add a schema under schemas/,
// point this at it, assert it in a contract test — no second Ajv wiring per
// tool. (validate-describe.ts stays specialized for the cordon command-surface
// contract + its prose lint; this is the generic data-contract counterpart.)
//
// Exits 0 + "valid: <schema>" on success; 1 with one diagnostic per error on a
// schema violation or bad JSON; 2 on usage error. So a contract test is one line
// in any language: `<tool> --json | validate-json schemas/<tool>.schema.json`.
import fs from 'node:fs';
import process from 'node:process';
import { text } from 'node:stream/consumers';
import { parseArgs } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { AnySchema } from 'ajv/dist/2020.js';
import { errorMessage, isRecord } from '../sdk/guards.ts';

const USAGE = 'usage: <document.json> | validate-json <schema.json>';

async function main(): Promise<number> {
  let schemaPath: string | undefined;
  try {
    const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true });
    if (positionals.length > 1) throw new Error('expected one schema path');
    schemaPath = positionals[0];
  } catch (error) {
    console.error(`${errorMessage(error)}\n${USAGE}`);
    return 2;
  }
  if (!schemaPath) {
    console.error(USAGE);
    return 2;
  }

  let schema: AnySchema;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    if (!isRecord(parsed)) throw new Error('schema must be a JSON object');
    schema = parsed;
  } catch (error) {
    console.error(`cannot read schema ${schemaPath}: ${errorMessage(error)}`);
    return 2;
  }
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

  let document: unknown;
  try {
    document = JSON.parse(await text(process.stdin));
  } catch (error) {
    console.error(`invalid JSON: ${errorMessage(error)}`);
    return 1;
  }

  if (!validate(document)) {
    for (const error of validate.errors || []) {
      console.error(`${error.instancePath || '/'} ${error.message}`);
    }
    return 1;
  }
  console.log(`valid: ${schemaPath.split('/').pop()}`);
  return 0;
}

process.exitCode = await main();
