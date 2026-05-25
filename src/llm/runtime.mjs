import { spawn } from 'node:child_process';
import { LLMError } from './errors.mjs';
import { createCommandInvocation } from './cli-resolver.mjs';

// Shared CLI spawn helper for stdio-based providers.
// Resolves { stdout, stderr, code } or rejects with LLMError.
export function runAsync(cmd, args, { input, cwd, timeout, agentName = 'agent', signal, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new LLMError(`${agentName} aborted`));

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const invocation = createCommandInvocation(cmd, args, env);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: process.platform === 'win32',
      windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    });

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      fn(value);
    };

    const onAbort = () => {
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000).unref?.();
      finish(reject, new LLMError(`${agentName} aborted`));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    timer = timeout
      ? setTimeout(() => {
          try { child.kill('SIGKILL'); } catch {}
          finish(reject, new LLMError(`${agentName} timed out after ${timeout}ms`));
        }, timeout)
      : null;

    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (e) => {
      finish(reject, new LLMError(`${agentName} spawn failed: ${e.message}`, { stdout, stderr, cause: e }));
    });
    child.on('close', (code) => {
      if (code === 0) finish(resolve, { stdout, stderr, code });
      else {
        const tail = stderr.slice(-1000) || stdout.slice(-1000);
        finish(reject, new LLMError(`${agentName} failed (exit ${code}): ${tail}`, { stdout, stderr, code }));
      }
    });

    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}
