const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PROJECT_MIRROR_PROBES, describeFilesystemError, prepareProjectMirrors } = require('./project-mirrors');
const { readProjectMirrorsInConsumer } = require('./project-mirror-consumer');

function readEntries(entries) {
  return entries.flatMap((entry) => {
    try {
      fs.readFileSync(entry.path);
      return [];
    } catch (error) {
      return [
        { ...entry, ...Object.fromEntries(['code', 'errno', 'syscall', 'message'].map((key) => [key, error[key]])) },
      ];
    }
  });
}

function formatFailures(failures) {
  return failures.map(
    (failure) => `${failure.reader ?? 'parent'} ${failure.kind} ${failure.path}: ${describeFilesystemError(failure)}`,
  );
}

function parentReaderReady(mirrorFailures, sourceFailures) {
  return mirrorFailures.length === 0 && sourceFailures.length === 0;
}

async function probeConsumer({ nodeExe, entries, signal, remaining, attempt, log }) {
  try {
    const failures = await readProjectMirrorsInConsumer({
      nodeExe,
      entries,
      signal,
      timeoutMs: Math.min(1000, remaining),
      onSpawn: (pid) => log(`Project mirror consumer attempt ${attempt + 1}: pid=${pid}, executable=${nodeExe}`),
    });
    signal?.throwIfAborted();
    return { failures: failures.map((failure) => ({ ...failure, reader: 'consumer' })) };
  } catch (error) {
    signal?.throwIfAborted();
    return { failures: [], error };
  }
}

/** Verify bundled resources before API startup; a fresh consumer is evidence,
 * not a claim about Windows cache behavior or permission-policy relaxation. */
async function waitForProjectMirrors({
  installRoot,
  projectDir,
  nodeExe,
  signal,
  log = () => {},
  timeoutMs = 5000,
  probes = PROJECT_MIRROR_PROBES,
}) {
  signal?.throwIfAborted();
  const deadline = Date.now() + timeoutMs;
  const entries = (kind, root) =>
    probes.map(({ mirror, relativePath }) => ({
      kind,
      mirror,
      path: path.join(root, mirror, relativePath),
    }));
  const mirrorEntries = entries('mirror', projectDir);
  const sourceEntries = entries('source', installRoot);
  let failures = readEntries(mirrorEntries);
  let sourceFailures = readEntries(sourceEntries);
  if (parentReaderReady(failures, sourceFailures)) {
    log(`Project mirror readiness verified (${probes.length} probes; parent reader)`);
    return { verification: 'parent' };
  }
  log(`Project mirror parent read failed:\n${formatFailures([...sourceFailures, ...failures]).join('\n')}`);
  let consumerFailures = [];
  let consumerError;
  let attempt = 0;
  let repaired = false;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    // Retest the parent after a short bounded backoff before spawning anything.
    await delay(Math.min(100 * 2 ** Math.min(attempt, 3), Math.max(1, deadline - Date.now())), undefined, { signal });
    signal?.throwIfAborted();
    failures = readEntries(mirrorEntries);
    sourceFailures = readEntries(sourceEntries);
    if (parentReaderReady(failures, sourceFailures)) {
      log(`Project mirror readiness verified (${probes.length} probes; parent reader after retry)`);
      return { verification: 'parent' };
    }
    log(
      `Project mirror recovery attempt ${attempt + 1}: parent mirror failures=${failures.length}, source failures=${sourceFailures.length}`,
    );
    if (!sourceFailures.length && !repaired && failures.length) {
      prepareProjectMirrors({ installRoot, projectDir, log, rebuildMirrors: failures.map(({ mirror }) => mirror) });
      repaired = true;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0 && nodeExe) {
      const result = await probeConsumer({
        nodeExe,
        entries: [...sourceEntries, ...mirrorEntries],
        signal,
        remaining,
        attempt,
        log,
      });
      consumerFailures = result.failures;
      consumerError = result.error;
      if (!consumerFailures.length && !consumerError) {
        log(
          `Project mirror readiness verified (${probes.length} probes; bundled Node consumer). Parent read remained unavailable; no ACL, configuration or history was changed.`,
        );
        return { verification: 'consumer' };
      }
    }
    attempt += 1;
  }
  const details = [...formatFailures(sourceFailures), ...formatFailures(failures), ...formatFailures(consumerFailures)];
  if (consumerError) details.push(`consumer ${nodeExe}: ${describeFilesystemError(consumerError)}`);
  throw new Error(`Project mirror readiness failed before API start:\n${details.join('\n')}`);
}

module.exports = { PROJECT_MIRROR_PROBES, waitForProjectMirrors };
