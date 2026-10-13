import { isRecord } from '../sdk/guards.ts';

/** The npm script ship gates on: "check" if defined, else "test", else ''. */
export function gateScript(packageJson: unknown): string {
  const scripts = isRecord(packageJson) && isRecord(packageJson['scripts']) ? packageJson['scripts'] : {};
  if (scripts['check']) return 'check';
  if (scripts['test']) return 'test';
  return '';
}
