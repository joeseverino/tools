#!/usr/bin/env node
import { text } from 'node:stream/consumers';
import { errorMessage, isRecord } from '../sdk/guards.ts';
import { validateContracts } from './describe-schema.ts';
import type { DescribeDocument } from './describe-schema.ts';

function isDescribeDocument(value: unknown): value is DescribeDocument {
  return isRecord(value);
}

function main(input: string): number {
  let document: unknown;
  try {
    document = JSON.parse(input);
  } catch (error) {
    console.error(`invalid JSON: ${errorMessage(error)}`);
    return 1;
  }
  if (!isDescribeDocument(document)) {
    console.error('invalid JSON: expected an object');
    return 1;
  }

  const result = validateContracts(document);
  if (!result.ok) {
    for (const error of result.errors) console.error(error);
    return 1;
  }
  console.log(`valid describe contracts: ${result.count}`);
  return 0;
}

process.exitCode = main(await text(process.stdin));
