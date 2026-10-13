import { SilentExit, die, usageError } from '../sdk/cli.ts';
import { blank, msg } from '../sdk/output.ts';
import { run } from '../sdk/process.ts';
import type { ToolSpec } from '../sdk/surface.ts';
import { createRuntime } from '../sdk/tool.ts';
import type { Handler, ToolDefinition, ToolRuntime } from '../sdk/tool.ts';
import { commandExists } from '../sdk/which.ts';
import type { GetoptsResult } from './stats.ts';
import { deltaLine, dohMillis, getopts, isWholeNumber, parseQueryTime, summarize, tableHeader, tableRow } from './stats.ts';

const DEFAULT_DOMAIN = 'google.com';
const DEFAULT_RUNS = '20';
const DEFAULT_BASELINE = 'AdGuard LAN';

export const spec: ToolSpec = {
  name: 'dns-test',
  description: 'Compare DNS resolver latency across paths.',
  group: 'Diagnostics',
  order: 80,
  effect: 'read',
  network: true,
  synopsis: ['dns-test [-d domain] [-n runs] [-a adguard_ip] [-b baseline] [-h]'],
  paras: [
    'Measures DNS latency across System DNS, a LAN AdGuard resolver, Cloudflare 1.1.1.1, and Cloudflare DoH. Reports avg/min/p50/p95/max and the delta of each path against a chosen baseline.',
    'The LAN resolver has no default — set ADGUARD_IP in your environment or pass -a to point at your own. Everything else measures the same way on any machine.',
  ],
  options: [
    { flags: ['-d'], metavar: 'domain', help: `Domain to query (default: ${DEFAULT_DOMAIN})` },
    { flags: ['-n'], metavar: 'runs', help: `Queries per path (default: ${DEFAULT_RUNS})` },
    { flags: ['-a'], metavar: 'ip', help: 'AdGuard LAN resolver IP (required; env ADGUARD_IP)' },
    { flags: ['-b'], metavar: 'label', help: `Path label to use as delta baseline (default: "${DEFAULT_BASELINE}")` },
  ],
  env: [{ name: 'ADGUARD_IP', help: 'AdGuard LAN resolver IP (overridden by -a)' }],
};

type Sampler = (arg: string) => string | null;

function digSampler(domain: string): Sampler {
  return (server) => {
    const args = ['+tries=1', '+time=2'];
    const result = run('dig', [...(server ? [`@${server}`] : []), ...args, domain]);
    return result.ok ? parseQueryTime(result.stdout) : null;
  };
}

function dohSampler(domain: string): Sampler {
  return (url) => {
    const result = run('curl', ['-fsS', '-o', '/dev/null', '-H', 'accept: application/dns-json', '-w', '%{time_total}', `${url}?name=${domain}&type=A`]);
    return result.ok ? dohMillis(result.stdout) : null;
  };
}

// seq decides how many rounds run, so odd counts (0, negatives, floats) behave
// as they always have on the host.
function rounds(runs: string): number {
  const result = run('seq', ['1', runs]);
  if (!result.ok) {
    process.stderr.write(result.stderr);
    throw new SilentExit(1);
  }
  return result.stdout.split('\n').filter(Boolean).length;
}

function measure(sampler: Sampler, arg: string, runs: string): string {
  const times: number[] = [];
  const count = rounds(runs);
  for (let attempt = 0; attempt < count; attempt += 1) {
    const sample = sampler(arg);
    if (sample !== null && isWholeNumber(sample)) times.push(Number(sample));
  }
  return summarize(String(Math.trunc(Number(runs))), times);
}

/** The help screen quotes the values parsed so far as the defaults, as the shell version did. */
function runtimeFor(parsed: GetoptsResult): ToolRuntime {
  const defaults = [
    parsed.domain ?? DEFAULT_DOMAIN,
    parsed.runs ?? DEFAULT_RUNS,
    parsed.baseline ?? DEFAULT_BASELINE,
  ];
  const options = (spec.options ?? []).map((option) => {
    if (option.flags[0] === '-d') return { ...option, help: `Domain to query (default: ${defaults[0]})` };
    if (option.flags[0] === '-n') return { ...option, help: `Queries per path (default: ${defaults[1]})` };
    if (option.flags[0] === '-b') return { ...option, help: `Path label to use as delta baseline (default: "${defaults[2]}")` };
    return option;
  });
  return createRuntime({ ...spec, options });
}

const handler: Handler = (args) => {
  const parsed = getopts(args);
  if (parsed.error?.kind === 'unknown') return runtimeFor(parsed).dieUnknown('option', `-${parsed.error.option}`);
  if (parsed.error?.kind === 'missing') return usageError(`-${parsed.error.option} requires an argument (try -h)`);
  if (parsed.help) {
    runtimeFor(parsed).printUsage();
    return 0;
  }

  const domain = parsed.domain ?? DEFAULT_DOMAIN;
  const runs = parsed.runs ?? DEFAULT_RUNS;
  const adguard = parsed.adguard ?? process.env['ADGUARD_IP'] ?? '';
  const baseline = parsed.baseline ?? DEFAULT_BASELINE;

  for (const command of ['dig', 'curl', 'awk', 'sort']) {
    if (!commandExists(command)) die('error', `missing required command: ${command}`);
  }

  if (!adguard) usageError('set ADGUARD_IP (or pass -a <ip>) to the LAN resolver to compare against');

  if (!run('dig', [`@${adguard}`, domain, '+tries=1', '+time=2', '+short']).ok) {
    blank();
    msg('yellow', 'warn', `AdGuard at ${adguard} not reachable; its row will show 0 successes.`);
  }

  const dig = digSampler(domain);
  const doh = dohSampler(domain);
  const paths: [string, Sampler, string][] = [
    ['System DNS', dig, ''],
    ['AdGuard LAN', dig, adguard],
    ['Cloudflare 1.1.1.1', dig, '1.1.1.1'],
    ['Cloudflare DoH', doh, 'https://cloudflare-dns.com/dns-query'],
  ];
  const results = new Map<string, string>();
  for (const [label, sampler, arg] of paths) {
    process.stderr.write(`  measuring ${label} ... `);
    results.set(label, measure(sampler, arg, runs));
    process.stderr.write('done\n');
  }

  const out = process.stdout;
  out.write(`\nDNS latency comparison\n  Domain:   ${domain}\n  Runs:     ${runs}\n  Baseline: ${baseline}\n\n`);
  out.write(`${tableHeader()}\n`);
  for (const [label] of paths) out.write(`${tableRow(label, results.get(label) ?? '')}\n`);
  out.write('\nNote: DoH includes TCP+TLS handshake per query (curl reopens the connection);\n');
  out.write('      dig figures are UDP round-trips. Treat the comparison accordingly.\n\n');

  const base = results.get(baseline);
  if (base === undefined) die('error', `baseline '${baseline}' not in path list`);
  const baseAvg = base.split(/\s+/)[0] ?? '';
  if (baseAvg === 'N/A') die('error', `baseline '${baseline}' had no successful queries`);

  out.write(`Delta vs ${baseline} (avg):\n`);
  for (const [label] of paths) {
    if (label === baseline) continue;
    const avg = (results.get(label) ?? '').split(/\s+/)[0] ?? '';
    if (avg === 'N/A') continue;
    out.write(`${deltaLine(label, avg, baseAvg)}\n`);
  }
  out.write('\n');
  return 0;
};

export const tool: ToolDefinition = { spec, run: handler };
