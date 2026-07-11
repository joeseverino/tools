import { spawn, spawnSync } from 'node:child_process';

function outcome(proc, bin, args) {
  const code = proc.status ?? (proc.error ? 1 : 0);
  const stdout = proc.stdout || '';
  const stderr = proc.stderr || '';
  return {
    ok: code === 0 && !proc.error,
    code,
    stdout,
    stderr,
    error: proc.error ? `${bin}: ${proc.error.message}` : code === 0 ? '' : stderr.trim() || stdout.trim() || `${bin} exited ${code}`,
    command: [bin, ...args],
  };
}

export function run(bin, args = [], options = {}) {
  const proc = spawnSync(bin, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env || {}) },
  });
  return outcome(proc, bin, args);
}

export function runJson(bin, args = [], options = {}) {
  const result = run(bin, args, options);
  if (!result.ok) return { ...result, json: null };
  try {
    return { ...result, json: JSON.parse(result.stdout || 'null') };
  } catch (error) {
    return { ...result, ok: false, json: null, error: `${bin}: invalid JSON: ${error.message}` };
  }
}

export function spawnJson(bin, args = [], options = {}) {
  const child = spawn(bin, args, {
    ...options,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ ok: false, code: 1, stdout, stderr, json: null, error: `${bin}: ${error.message}`, command: [bin, ...args] }));
    child.on('close', (code) => {
      const base = { ok: code === 0, code, stdout, stderr, error: code === 0 ? '' : stderr.trim() || stdout.trim() || `${bin} exited ${code}`, command: [bin, ...args] };
      if (!base.ok) return resolve({ ...base, json: null });
      try { resolve({ ...base, json: JSON.parse(stdout || 'null') }); }
      catch (error) { resolve({ ...base, ok: false, json: null, error: `${bin}: invalid JSON: ${error.message}` }); }
    });
  });
}
