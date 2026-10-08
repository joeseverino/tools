import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tools-unit-'));
const manifest = path.join(dir, 'capabilities.json');
const graph = path.join(dir, 'contracts.json');

const manifestBody = {
  capabilities_version: 1,
  repositories: [
    { id: 'alpha', path: 'Assets/alpha', describe: ['alpha', 'describe'], install: ['make', 'install'], fingerprint: { installed: ['alpha', '--fp'], source: ['make', 'fp'] } },
    { id: 'beta', path: 'Assets/beta', brief_section: true },
    { id: 'severino-vault-mcp', path: 'Assets/mcp', describe: ['mcp', 'describe'] },
  ],
};
fs.writeFileSync(manifest, JSON.stringify(manifestBody));

process.env['TOOLS_CAPABILITIES'] = manifest;
process.env['TOOLS_CONTRACT_GRAPH'] = graph;
process.env['CODE_HOME'] = '/code';
process.env['MCP_HOME'] = '/override/mcp';
const capabilities = await import('../../lib/tools/capabilities.ts');
const contracts = await import('../../lib/tools/contracts.ts');

test('capabilityPaths lists repositories that declare a capability', () => {
  assert.deepEqual(capabilities.capabilityPaths('describe'), [
    { id: 'alpha', path: '/code/Assets/alpha' },
    { id: 'severino-vault-mcp', path: '/override/mcp' },
  ]);
  assert.deepEqual(capabilities.capabilityPaths('brief_section'), [{ id: 'beta', path: '/code/Assets/beta' }]);
  assert.deepEqual(capabilities.capabilityPaths('nothing'), []);
});

test('repositoryEntries resolves every repository, honouring env overrides', () => {
  assert.deepEqual(capabilities.repositoryEntries().map((entry) => entry.path), [
    '/code/Assets/alpha', '/code/Assets/beta', '/override/mcp',
  ]);
});

test('repositoryCapability returns a command or null', () => {
  assert.deepEqual(capabilities.repositoryCapability('alpha', 'install'), ['make', 'install']);
  assert.equal(capabilities.repositoryCapability('alpha', 'brief_section'), null);
  assert.equal(capabilities.repositoryCapability('missing', 'install'), null);
});

test('isCommand needs a non-empty array of strings', () => {
  assert.equal(capabilities.isCommand(['a']), true);
  assert.equal(capabilities.isCommand([]), false);
  assert.equal(capabilities.isCommand(['a', 1]), false);
  assert.equal(capabilities.isCommand('a'), false);
});

test('loadCapabilities rejects an unsupported manifest', () => {
  fs.writeFileSync(manifest, JSON.stringify({ capabilities_version: 2, repositories: [] }));
  assert.throws(() => capabilities.loadCapabilities(), /unsupported capabilities manifest/);
  fs.writeFileSync(manifest, JSON.stringify({ capabilities_version: 1, repositories: [{ id: 'x' }] }));
  assert.throws(() => capabilities.loadCapabilities(), /unsupported capabilities manifest/);
  fs.writeFileSync(manifest, JSON.stringify(manifestBody));
});

function contract(id: string) {
  return { id, owner: 'o', description: 'd', source: { repository: 'tools', path: 'x' } };
}
function projection(id: string, contractId: string) {
  return { id, contract: contractId, consumer: 'c', description: 'd', scope: 'local', check: { repository: 'tools', argv: ['true'] } };
}

test('loadContractGraph validates shape and unique ids', () => {
  fs.writeFileSync(graph, JSON.stringify({ contract_graph_version: 1, contracts: [contract('a')], projections: [projection('p', 'a')] }));
  assert.equal(contracts.loadContractGraph().contracts.length, 1);

  fs.writeFileSync(graph, JSON.stringify({ contract_graph_version: 1, contracts: [contract('a'), contract('a')], projections: [] }));
  assert.throws(() => contracts.loadContractGraph(), /duplicate contract id: a/);

  fs.writeFileSync(graph, JSON.stringify({ contract_graph_version: 1, contracts: [contract('a')], projections: [projection('p', 'zzz')] }));
  assert.throws(() => contracts.loadContractGraph(), /unknown contract: zzz/);

  fs.writeFileSync(graph, JSON.stringify({ contract_graph_version: 1, contracts: [contract('a')], projections: [{ id: 'p' }] }));
  assert.throws(() => contracts.loadContractGraph(), /invalid contract graph/);
});

test('deriveProjections plans without running and rejects bad scope or empty selection', () => {
  const repair = { repository: 'tools', argv: ['touch', 'x'], effect: 'local_write' };
  fs.writeFileSync(graph, JSON.stringify({
    contract_graph_version: 1,
    contracts: [contract('a')],
    projections: [{ ...projection('p', 'a'), repair }],
  }));
  const planned = contracts.deriveProjections({ id: 'p' });
  assert.equal(planned.ok, true);
  assert.equal(planned.results[0]?.status, 'planned');
  assert.equal(planned.results[0]?.invocation, 'touch x');
  assert.throws(() => contracts.deriveProjections({ id: 'p', scope: 'live' }), /unknown derive scope/);
  assert.throws(() => contracts.deriveProjections({}), /name one projection/);
});
