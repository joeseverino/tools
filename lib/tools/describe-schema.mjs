import fs from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaPath = new URL('../../schemas/describe-v4.schema.json', import.meta.url);
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

// A paragraph in the contract is ONE logical, unwrapped sentence-or-more —
// renderers (-h, README, TUI) reflow it to their own width. So presentation
// line-breaks must never be baked into the data: a `desc_para` that ends
// mid-sentence (a hard-wrap fragment of a longer paragraph) or is empty is a
// drift smell that fragments every renderer. This is the cheap honesty guard
// that keeps the source of truth reflowable. Sentence-ending or lead-in
// punctuation (. ! ? : ) ] " ' …) is fine; a trailing lowercase letter, digit,
// or comma means the sentence was cut across two calls.
const PARA_FRAGMENT = /[a-z0-9,]$/;

function lintProse(contract, errors) {
  const name = contract?.name || '(unknown)';
  const check = (paras, scope) => {
    for (const para of paras || []) {
      const text = String(para).trim();
      if (!text) {
        errors.push(`${name} ${scope}: empty paragraph (drop the desc_para "" separator; renderers space paragraphs automatically)`);
      } else if (PARA_FRAGMENT.test(text)) {
        errors.push(`${name} ${scope}: paragraph ends mid-sentence — store one logical paragraph per desc_para, not a hard-wrapped line: ${JSON.stringify(text.slice(-48))}`);
      }
    }
  };
  check(contract.paras, '/paras');
  for (const command of contract.commands || []) {
    check(command.paras, `/commands/${command.name}/paras`);
  }
}

export function validateContracts(document) {
  const contracts = Array.isArray(document.tools) ? document.tools : [document];
  const errors = [];
  for (const contract of contracts) {
    if (!validate(contract)) {
      const name = contract?.name || '(unknown)';
      for (const error of validate.errors || []) {
        errors.push(`${name}${error.instancePath || '/'} ${error.message}`);
      }
    }
    lintProse(contract, errors);
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
