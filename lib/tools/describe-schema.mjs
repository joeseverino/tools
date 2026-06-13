import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaPath = new URL('../../schemas/describe-v4.schema.json', import.meta.url);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

export function validateContracts(document) {
  const contracts = Array.isArray(document.tools) ? document.tools : [document];
  const errors = [];
  for (const contract of contracts) {
    if (validate(contract)) continue;
    const name = contract?.name || '(unknown)';
    for (const error of validate.errors || []) {
      errors.push(`${name}${error.instancePath || '/'} ${error.message}`);
    }
  }
  if (Array.isArray(document.tools)) {
    const orders = new Map();
    for (const contract of contracts) {
      if (!Number.isInteger(contract.order)) continue;
      if (orders.has(contract.order)) {
        errors.push(`duplicate tool order ${contract.order}: ${orders.get(contract.order)}, ${contract.name}`);
      } else {
        orders.set(contract.order, contract.name);
      }
    }
  }
  return { ok: errors.length === 0, count: contracts.length, errors };
}
