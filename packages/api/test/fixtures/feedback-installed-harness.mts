import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from '@clowder-ai/plugin-contract';
import Fastify from 'fastify';
import { parse } from 'yaml';
import { createModuleHostInvocation } from '../../src/domains/plugin/builtin-runtime/carriers/module-host-invocation.js';
import type { PluginRuntimeAdmission } from '../../src/domains/plugin/carrier/runtime-carrier.js';
import { DeclaredPluginUi } from '../../src/domains/plugin/declared/declared-plugin-ui.js';
import { pluginUiRoutes } from '../../src/routes/plugin/plugin-ui-routes.js';

export async function startInstalledFeedbackFixture() {
  const archive = resolve(process.env.FEEDBACK_ARTIFACT ?? 'missing-feedback-artifact');
  const artifactRoot = resolve(process.env.FEEDBACK_JOURNEY_ARTIFACTS ?? '../../artifacts/feedback-installed');
  const consumer = join(
    artifactRoot,
    `consumer-${createHash('sha256')
      .update(await readFile(archive))
      .digest('hex')
      .slice(0, 12)}`,
  );
  await mkdir(consumer, { recursive: true });
  await writeFile(
    join(consumer, 'package.json'),
    '{"name":"isolated-feedback-consumer","private":true,"type":"module"}',
  );
  const npmCli = process.env.FEEDBACK_NPM_CLI;
  assert.ok(npmCli, 'FEEDBACK_NPM_CLI must identify the pinned npm CLI');
  execFileSync(
    process.execPath,
    [
      npmCli,
      'install',
      '--ignore-scripts',
      '--omit=dev',
      '--no-audit',
      '--no-fund',
      '--cache',
      join(artifactRoot, 'npm-cache'),
      archive,
    ],
    { cwd: consumer, stdio: 'pipe' },
  );
  const packageRoot = join(consumer, 'node_modules/@clowder-ai/feedback');
  const manifest = parse(await readFile(join(packageRoot, 'plugin.yaml'), 'utf8'));
  assert.equal(validateManifest(manifest).valid, true);
  const module = await import(pathToFileURL(join(packageRoot, 'dist/index.js')).href);
  const esbuild = createRequire(import.meta.url)(
    createRequire(import.meta.url).resolve('esbuild', { paths: [createRequire(import.meta.url).resolve('tsx')] }),
  );
  const playwright = createRequire(import.meta.url)(process.env.FEEDBACK_PLAYWRIGHT_MODULE ?? 'playwright');
  const webRoot = resolve('../web');
  const bundle = await esbuild.build({
    absWorkingDir: webRoot,
    stdin: {
      resolveDir: webRoot,
      loader: 'tsx',
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{PluginUiEntries}from'./src/components/plugins/PluginUiEntries';createRoot(document.getElementById('rail')).render(<PluginUiEntries/>);`,
    },
    jsx: 'automatic',
    bundle: true,
    write: false,
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"test"' },
    alias: { '@/utils/api-client': resolve('test/fixtures/feedback-api.ts') },
  });

  let png = Buffer.alloc(0);
  const targets = [
    {
      id: 'internal',
      label: '内部反馈',
      revision: 1,
      provider: 'gitlab',
      mode: 'both',
      project: 'team/clowder-ai',
      apiBaseUrl: 'https://gitlab.example.test/api/v4',
      issueCreateUrl: 'https://gitlab.example.test/team/clowder-ai/-/issues/new',
      visibility: 'private',
      attachmentOrigins: [],
    },
  ];
  const values = new Map<string, { revision: number; value: unknown }>();
  let revision = 0;
  let modelPrompt = '';
  let posts = 0;
  const issues = new Map<string, { iid: number; web_url: string; title: string; description: string }>();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (!address.startsWith('https://gitlab.example.test')) return originalFetch(url, init);
    const json = (value: unknown) => new Response(JSON.stringify(value));
    if (address.endsWith('/user')) return json({ username: 'fixture-owner' });
    if (address.endsWith('/uploads') && init?.method === 'POST') {
      assert.ok(init.body instanceof FormData);
      assert.deepEqual(Buffer.from(await (init.body.get('file') as File).arrayBuffer()), png);
      return json({ full_path: '/team/clowder-ai/uploads/fixture/screenshot-1.png' });
    }
    if (address.includes('/uploads/fixture/')) return new Response(png);
    if (address.endsWith('/issues') && init?.method === 'POST') {
      posts++;
      const data = JSON.parse(String(init.body));
      const issue = {
        iid: posts,
        web_url: `https://gitlab.example.test/team/clowder-ai/-/issues/${posts}`,
        title: data.title,
        description: data.description,
      };
      issues.set(String(posts), issue);
      return json(issue);
    }
    const id = address.match(/\/issues\/(\d+)$/)?.[1];
    if (id) return json(issues.get(id));
    return json({ path_with_namespace: 'team/clowder-ai', visibility: 'private', issues_enabled: true });
  };
  const host = {
    pluginInstanceId: 'fixture',
    dataPath: join(artifactRoot, 'retained-data'),
    config: { get: async () => JSON.stringify(targets) },
    secrets: { get: async () => 'synthetic-token' },
    storage: {
      get: async (key: string) => structuredClone(values.get(key)),
      compareAndSet: async (key: string, expected: number | null, value: unknown) => {
        if ((values.get(key)?.revision ?? null) !== expected) return { applied: false };
        const r = ++revision;
        values.set(key, { revision: r, value: structuredClone(value) });
        await writeFile(join(artifactRoot, 'retained-journal.json'), JSON.stringify([...values]));
        return { applied: true, revision: r };
      },
    },
    diagnostics: {
      describe: async () => ({
        environment: 'Windows fixture Node 24',
        projectRoot: 'C:\\Users\\Alice\\project',
        clients: [{ id: 'configured', label: '已配置 Client', provider: 'synthetic', model: 'fixture' }],
      }),
      collect: async () => 'api_key=log-secret-canary E_TIMEOUT C:\\Users\\Alice\\project\\a.ts',
      analyze: async (input: { prompt: string }) => {
        modelPrompt = input.prompt;
        return '## 初步分析\n事实：E_TIMEOUT\n推测：信息不足\n未验证：尚未复现\napi_key=model-secret-canary';
      },
    },
  };
  const activation = await module.default.create(manifest).start(host);
  const invocation = createModuleHostInvocation({ runtime: { actions: () => activation.actions } });
  const ui = new DeclaredPluginUi((id, method, input) => invocation.invoke(id, method, input));
  const admission = {
    instance: { pluginInstanceId: 'fixture' },
    packageRecord: { pluginId: manifest.pluginId, manifest },
  } as unknown as PluginRuntimeAdmission;
  ui.activate(admission);
  const app = Fastify();
  app.decorateRequest('sessionUserId', undefined);
  app.addHook('onRequest', async (request) => {
    request.sessionUserId = 'fixture-owner';
  });
  await app.register(pluginUiRoutes, { ui });
  app.get('/', async (_, reply) =>
    reply
      .type('text/html')
      .send(
        `<!doctype html><html><style>dialog{margin:auto;width:min(820px,96vw);height:min(900px,94dvh);max-width:none;overflow:hidden;padding:0;border:1px solid #e9e5e1;border-radius:16px}dialog iframe{width:100%;height:100%;border:0}dialog::backdrop{background:#0006}dialog>div{position:absolute;right:12px;top:8px}</style><body style="margin:0;background:#f8f7f5"><aside id="rail" style="position:fixed;inset:0 auto 0 0;width:56px;display:flex;flex-direction:column;justify-content:flex-end;padding-bottom:20px"></aside><main id="workspace"></main><script>${bundle.outputFiles[0].text}</script></body></html>`,
      ),
  );
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const ledger = {
    task: 'feedback-implementation',
    owner: 'codex',
    purpose: 'packed plugin / actual Host UI bridge deterministic journey',
    pid: process.pid,
    url,
    sourceRoot: process.cwd(),
    archive,
    archiveSha256: createHash('sha256')
      .update(await readFile(archive))
      .digest('hex'),
    dataRoot: host.dataPath,
    state: 'running',
    nativeHistory: 'not bound; no real model invocation',
    startedAt: new Date().toISOString(),
  };
  await writeFile(join(artifactRoot, 'instance-ledger.json'), JSON.stringify(ledger, null, 2));

  return {
    artifactRoot,
    playwright,
    ledger,
    url,
    targets,
    issues,
    setPng(value: Buffer) {
      png = value;
    },
    posts: () => posts,
    modelPrompt: () => modelPrompt,
    async stop() {
      ui.deactivate('fixture');
      await activation.stop({ reason: 'test_complete' });
      await app.close();
      globalThis.fetch = originalFetch;
      await writeFile(
        join(artifactRoot, 'instance-ledger.json'),
        JSON.stringify(
          {
            ...ledger,
            state: 'stopped',
            stoppedAt: new Date().toISOString(),
            retained: 'archive, screenshots, synthetic journal and receipt; no native history',
          },
          null,
          2,
        ),
      );
    },
  };
}
