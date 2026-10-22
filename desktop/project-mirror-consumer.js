const { spawn } = require('node:child_process');

// Inline the static worker: Electron may load this module from app.asar, while
// the bundled Node consumer cannot execute a script inside Electron's archive.
const WORKER = `
const fs = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const entries = JSON.parse(input);
    const failures = [];
    for (const entry of entries) {
      try { fs.readFileSync(entry.path); }
      catch (error) {
        failures.push({ ...entry, code: error.code, errno: error.errno, syscall: error.syscall, message: error.message });
      }
    }
    process.stdout.write(JSON.stringify({ version: 1, failures }));
  } catch (error) {
    process.stderr.write(error.message);
    process.exitCode = 1;
  }
});
`;

/** Read using the actual API executable and inherited user token; settle after close. */
function readProjectMirrorsInConsumer({ nodeExe, entries, signal, timeoutMs = 1000, onSpawn = () => {} }) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(nodeExe, ['-e', WORKER], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }
    let output = '';
    let stderr = '';
    let failure;
    let stopped = false;
    const stop = (error) => {
      if (stopped) return;
      stopped = true;
      failure = error;
      // This read-only probe owns no durable state. A handler installed by a
      // preload must not turn cancellation into an unbounded startup wait.
      child.kill('SIGKILL');
    };
    const abort = () => stop(signal.reason ?? new Error('Project mirror consumer aborted'));
    const timer = setTimeout(
      () =>
        stop(
          Object.assign(new Error('Project mirror consumer timed out'), {
            code: 'ETIMEDOUT',
            syscall: 'read',
          }),
        ),
      Math.max(1, timeoutMs),
    );
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', (error) => {
      failure ??= error;
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.once('spawn', () => {
      try {
        onSpawn(child.pid);
      } catch {
        /* Diagnostics cannot strand the child. */
      }
    });
    child.stdin.on('error', () => {}); // EPIPE is reported by process error/close.
    child.stdout.on('data', (chunk) => {
      if (output.length + chunk.length > 64 * 1024) {
        stop(new Error('Project mirror consumer returned oversized diagnostics'));
      } else output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failure) return reject(failure);
      if (code !== 0) return reject(new Error(`Project mirror consumer exited ${code}: ${stderr}`));
      try {
        const result = JSON.parse(output);
        if (result.version !== 1 || !Array.isArray(result.failures)) throw new Error('Invalid consumer diagnostics');
        resolve(result.failures);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(entries));
    if (signal?.aborted) abort();
  });
}

module.exports = { readProjectMirrorsInConsumer };
