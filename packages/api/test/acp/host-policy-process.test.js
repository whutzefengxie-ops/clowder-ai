// Exercises compiled production consumers in owned, hidden Node subprocesses.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const policyModule = new URL('../../dist/config/acp-host-policy.js', import.meta.url).href;
const fileModule = new URL('../../dist/config/host-policy-file.js', import.meta.url).href;
const bootstrapModule = new URL('../../dist/config/trusted-host-compatibility.js', import.meta.url).href;
const auditModule = new URL('../../dist/config/acp-bootstrap-config-audit-policy.js', import.meta.url).href;

test(
  'real child boot reads once; changed owner file reaches both consumers only after restart',
  { timeout: 15000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), 'host-policy-process-'));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'host-policy.json');
    writeFileSync(path, '{"bootstrapMode":"trusted-host","auditMode":"warn-bootstrap-root"}');
    const code = `
    import {installAcpHostPolicy,getAcpHostPolicy} from ${JSON.stringify(policyModule)};
    import {loadAcpHostPolicy} from ${JSON.stringify(fileModule)};
    import {isTrustedHostCompatibilityEnabled} from ${JSON.stringify(bootstrapModule)};
    import {allowsAcpBootstrapConfigAuditWarning} from ${JSON.stringify(auditModule)};
    const policy=loadAcpHostPolicy();
    installAcpHostPolicy(policy);
    const emit=()=>console.log(JSON.stringify({policy:getAcpHostPolicy(),trusted:isTrustedHostCompatibilityEnabled(),audit:allowsAcpBootstrapConfigAuditWarning()}));
    emit();
    process.stdin.once('data',()=>{emit();process.exit(0)});
  `;
    const boot = () => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
        env: {
          ...process.env,
          CAT_CAFE_HOST_POLICY_FILE: path,
          CAT_CAFE_WINDOWS_ACP_BOOTSTRAP_MODE: 'strict',
          CAT_CAFE_ACP_BOOTSTRAP_CONFIG_AUDIT_MODE: 'required',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      t.after(() => child.kill());
      const output = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
      return {
        child,
        read: async () => {
          const line = await output.next();
          assert.equal(line.done, false, 'child must emit a policy snapshot');
          return JSON.parse(line.value);
        },
      };
    };
    const first = boot();
    const initial = await first.read();
    assert.equal(initial.trusted, true);
    assert.equal(initial.audit, process.platform === 'win32');
    assert.equal(initial.policy.bootstrapSource, 'owner');
    const strictText = '{"bootstrapMode":"strict","auditMode":"required"}';
    writeFileSync(path, strictText);
    first.child.stdin.end('inspect\n');
    assert.deepEqual(await first.read(), initial);
    await once(first.child, 'exit');
    const restarted = boot();
    const next = await restarted.read();
    assert.equal(next.trusted, false);
    assert.equal(next.audit, false);
    restarted.child.stdin.end('inspect\n');
    assert.deepEqual(await restarted.read(), next);
    await once(restarted.child, 'exit');
    assert.equal(readFileSync(path, 'utf8'), strictText, 'startup must not rewrite the owner file');
  },
);

test('the production API entry rejects malformed owner policy before starting services', { timeout: 20000 }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'host-policy-invalid-api-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'host-policy.json');
  writeFileSync(path, '{invalid');
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../dist/index.js', import.meta.url))], {
    env: {
      ...process.env,
      CAT_CAFE_HOST_POLICY_FILE: path,
      API_SERVER_PORT: '0',
      MEMORY_STORE: '1',
      CAT_CAFE_INVOCATION_REGISTRY: 'memory',
      CAT_CAFE_DISABLE_SHARED_STATE_PREFLIGHT: '1',
    },
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
  assert.equal(run.error, undefined);
  assert.notEqual(run.status, 0);
  assert.match(run.stdout + run.stderr, /Invalid Host policy file/);
  assert.equal(readFileSync(path, 'utf8'), '{invalid');
});
