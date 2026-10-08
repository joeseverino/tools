// `tools check`: the CI suite runnable locally. CI calls it so the definition of
// "passing" lives in one place.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { applyCiEnv } from '../sdk/ci.ts';
import { blank, msg, palette } from '../sdk/output.ts';
import { toolsHome } from '../sdk/paths.ts';
import { run } from '../sdk/process.ts';
import { CheckReport, tail } from '../sdk/report.ts';
import { which } from '../sdk/which.ts';

export interface CheckOptions {
  bench: boolean;
  ci: boolean;
}

function indent(text: string): string {
  return text.replace(/\n+$/, '').split('\n').map((line) => `    ${line}`).join('\n');
}

function combined(bin: string, args: readonly string[], options: { input?: string } = {}): { ok: boolean; output: string } {
  const result = spawnSync('/bin/sh', ['-c', 'exec "$@" 2>&1', 'check', bin, ...args], { encoding: 'utf8', ...options });
  return { ok: result.status === 0, output: result.stdout.replace(/\n+$/, '') };
}

/** True when the first line of the file names the interpreter. */
export function shebangHas(file: string, word: string): boolean {
  try {
    return (readFileSync(file, 'utf8').split('\n')[0] ?? '').includes(word);
  } catch {
    return false;
  }
}

function listDir(dir: string, suffix = ''): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).sort().filter((name) => name.endsWith(suffix)).map((name) => `${path.basename(dir)}/${name}`).filter((file) => statSync(file).isFile());
}

function ciBatsCheck(doctor: CheckReport): boolean {
  const want = process.env['TOOLS_CI_BATS_VERSION'] ?? '';
  if (!which('bats')) {
    doctor.check('bats version', false, 'bats not installed (brew install bats-core)');
    return false;
  }
  const have = run('bats', ['--version']).stdout.trim().split(/\s+/).at(-1) ?? '';
  if (want && have !== want) {
    doctor.check('bats version', false, `have ${have}, CI pins ${want} (TOOLS_CI_BATS_VERSION)`);
    return false;
  }
  doctor.check('bats version', true, `${have}${want ? ' · pinned' : ''}`);
  return true;
}

function syntaxStep(doctor: CheckReport, label: string, shell: string, files: readonly string[]): boolean {
  let stepOk = true;
  let count = 0;
  for (const file of files) {
    if (!shebangHas(file, shell)) continue;
    count += 1;
    const result = combined(shell, ['-n', file]);
    if (!result.ok) {
      msg('red', 'fail', `${label} ${file}`);
      process.stdout.write(`${indent(result.output)}\n`);
      stepOk = false;
    }
  }
  return doctor.check(label, stepOk, `${count} scripts`);
}

function failWith(doctor: CheckReport, label: string, output: string, detail: string): boolean {
  process.stdout.write(`${indent(output)}\n`);
  return doctor.check(label, false, detail);
}

export function runCheck(options: CheckOptions, home = toolsHome): number {
  if (options.ci) applyCiEnv(home);
  process.chdir(home);
  const doctor = new CheckReport(false);
  let ok = true;
  const record = (passed: boolean): void => {
    if (!passed) ok = false;
  };

  blank();
  if (options.ci) {
    msg('dim', 'ci', 'hermetic gate · repo bin first, install dir off $PATH · clean git config');
    record(ciBatsCheck(doctor));
  }

  const bin = listDir('bin');
  const bench = listDir('bench', '.sh');
  record(syntaxStep(doctor, 'bash -n', 'bash', [...bin, ...bench]));
  record(syntaxStep(doctor, 'zsh -n', 'zsh', bin));

  const tsc = path.join(home, 'node_modules/.bin/tsc');
  if (existsSync(tsc)) {
    const result = combined(tsc, ['-p', home]);
    if (result.ok) {
      const modules = run('git', ['ls-files', 'lib/*.ts', 'lib/**/*.ts']).stdout.split('\n').filter(Boolean).length;
      doctor.check('typecheck', true, `${modules} modules, strict`);
    } else record(failWith(doctor, 'typecheck', result.output, 'errors above'));
  } else record(doctor.check('typecheck', false, 'run npm ci (TypeScript is required)'));

  if (which('node') && existsSync(path.join(home, 'node_modules/ajv'))) {
    const described = run(path.join(home, 'bin/tools'), ['describe', '--repos']);
    const validated = combined('node', [path.join(home, 'lib/tools/validate-describe.ts')], { input: described.stdout });
    if (validated.ok) doctor.check('describe schema', true, validated.output);
    else record(failWith(doctor, 'describe schema', validated.output, 'validation errors above'));

    const schemaStep = (label: string, schema: string, document: string, success: string): void => {
      const result = combined('node', [path.join(home, 'lib/tools/validate-json.ts'), path.join(home, schema)], { input: readFileSync(path.join(home, document), 'utf8') });
      if (result.ok) doctor.check(label, true, success);
      else record(failWith(doctor, label, result.output, 'validation errors above'));
    };
    schemaStep('capability schema', 'schemas/capabilities-v1.json', 'config/capabilities.json', 'fleet manifest valid');
    schemaStep('contract graph schema', 'schemas/contract-graph-v1.json', 'config/contracts.json', 'producer/consumer graph valid');

    const projections = combined('node', [path.join(home, 'lib/tools/contracts.ts'), '--check', '--scope', 'local', '--json']);
    if (projections.ok) doctor.check('contract projections', true, 'all declared projections current');
    else record(failWith(doctor, 'contract projections', projections.output, 'run: tools contracts --check'));
  } else record(doctor.check('describe schema', false, 'run npm ci (Ajv is required)'));

  if (which('shellcheck')) {
    const targets = [...bin, ...bench].filter((file) => shebangHas(file, 'bash'));
    const listed = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'lib/*.sh', 'config/*.sh', 'config/*.sh.example']);
    for (const file of listed.stdout.split('\n')) if (file && existsSync(file) && statSync(file).isFile()) targets.push(file);
    const result = combined('shellcheck', ['-x', ...targets]);
    if (result.ok) doctor.check('shellcheck', true, `${targets.length} files`);
    else record(failWith(doctor, 'shellcheck', result.output, 'findings above'));
  } else record(doctor.check('shellcheck', false, 'not installed (brew install shellcheck)'));

  if (existsSync('tests')) {
    if (which('bats')) {
      const result = combined('bats', ['tests']);
      if (result.ok) doctor.check('bats tests', true, `${result.output.split('\n').filter((line) => line.startsWith('ok')).length} passed`);
      else record(failWith(doctor, 'bats tests', result.output, 'failures above'));
    } else record(doctor.check('bats tests', false, 'bats not installed (brew install bats-core)'));
  }

  if (options.bench) {
    for (const file of bench) {
      const result = combined(`./${file}`, []);
      const label = `bench ${path.basename(file)}`;
      if (result.ok) doctor.check(label, true);
      else {
        process.stdout.write(`${tail(result.output, 20).map((line) => `    ${line}`).join('\n')}\n`);
        record(doctor.check(label, false, 'output above'));
      }
    }
  }

  const p = palette();
  blank();
  if (!ok) {
    process.stdout.write(`  ${p.BOLD}${p.RED}check${p.RESET}     one or more checks failed\n\n`);
    return 1;
  }
  process.stdout.write(`  ${p.BOLD}${p.GREEN}check${p.RESET}     all checks passed\n\n`);
  return 0;
}
