import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('hindsight p0 health-check self-test passes', () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const scriptPath = resolve(testDir, '..', '..', '..', 'scripts', 'hindsight', 'p0-health-check.sh');
  const result = spawnSync('bash', [scriptPath, '--self-test'], {
    encoding: 'utf8',
  });

  assert.equal(
    result.status,
    0,
    [`exit=${result.status}`, `stdout:\n${result.stdout}`, `stderr:\n${result.stderr}`].join('\n'),
  );
});
