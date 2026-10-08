import { SilentExit } from '../sdk/cli.ts';
import { parseJson } from '../sdk/guards.ts';
import { run } from '../sdk/process.ts';
import { reposFrom } from '../repos/project.ts';
import type { PlanRepo } from '../repos/project.ts';

/** Reads the fleet from `repos --json` (the one read owner), resolved by name on PATH. */
export function readFleet(args: readonly string[]): PlanRepo[] {
  const result = run('repos', ['--json', ...args]);
  if (!result.ok) throw new SilentExit(result.code || 1);
  return reposFrom(parseJson(result.stdout));
}
