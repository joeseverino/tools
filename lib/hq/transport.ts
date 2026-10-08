// The two external crossings hq makes: the operator's HQ tool transport
// ($HQ_CALL, default lib/hq-call) and the vault MCP CLI ($SVMC_BIN).
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { die } from '../sdk/cli.ts';
import { toolsHome } from '../sdk/paths.ts';
import { which } from '../sdk/which.ts';

const MAX_BUFFER = 256 * 1024 * 1024;

function executableFile(file: string): boolean {
  return which(file) !== null;
}

export interface TransportResult {
  status: number;
  stdout: string;
}

/** One HQ tool call as the operator: the request on stdin, the tool's JSON result on stdout. */
export function callTransport(request: unknown): TransportResult {
  const call = process.env['HQ_CALL'] || path.join(toolsHome, 'lib/hq-call');
  if (!executableFile(call)) die('error', `HQ call transport is unavailable: ${call}`);
  const proc = spawnSync(call, [], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: MAX_BUFFER,
  });
  return { status: proc.status ?? 1, stdout: proc.stdout ?? '' };
}
