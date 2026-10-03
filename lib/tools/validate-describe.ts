#!/usr/bin/env node
import process from 'node:process';
import { validateContracts } from './describe-schema.ts';
import type { DescribeDocument } from './describe-schema.ts';

let input = '';
for await (const chunk of process.stdin) input += chunk;

let document: DescribeDocument;
try {
  document = JSON.parse(input) as DescribeDocument;
} catch (error) {
  console.error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const result = validateContracts(document);
if (!result.ok) {
  for (const error of result.errors) console.error(error);
  process.exit(1);
}
console.log(`valid describe contracts: ${result.count}`);
