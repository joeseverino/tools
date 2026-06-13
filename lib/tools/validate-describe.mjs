#!/usr/bin/env node
import process from 'node:process';
import { validateContracts } from './describe-schema.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;

let document;
try {
  document = JSON.parse(input);
} catch (error) {
  console.error(`invalid JSON: ${error.message}`);
  process.exit(1);
}

const result = validateContracts(document);
if (!result.ok) {
  for (const error of result.errors) console.error(error);
  process.exit(1);
}
console.log(`valid describe contracts: ${result.count}`);
