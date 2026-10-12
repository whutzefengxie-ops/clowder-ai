import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Receiver } from '../src/engine.mjs';
import { git } from '../src/process.mjs';
import { createReceiverServer, listen } from '../src/server.mjs';
import { repositories } from '../test/fixtures.mjs';
import { versionRepositories } from '../test/version-fixtures.mjs';

const firstPort = Number(process.env.REPO_SYNC_MODES_PORT ?? 5190);
const demoLinks = Object.fromEntries(
  ['continuous', 'version', 'conflict'].map((mode, i) => [mode, `http://127.0.0.1:${firstPort + i}/`]),
);
for (const [index, mode] of ['continuous', 'version', 'conflict'].entries()) {
  const fixture = mode === 'continuous' ? await repositories() : await versionRepositories();
  if (mode === 'conflict') {
    await writeFile(join(fixture.review, 'README.md'), '内部新版介绍\n\n运行说明\n\n内部联系说明\n');
    await git(fixture.review, ['add', '.']);
    await git(fixture.review, ['commit', '-m', 'synthetic conflicting customization']);
    await git(fixture.review, ['push', 'origin', 'main']);
    fixture.i0 = await git(fixture.review, ['rev-parse', 'HEAD']);
  }
  const receiver = new Receiver(fixture.config);
  await receiver.adopt(fixture.u0, fixture.i0);
  if (mode === 'continuous') await receiver.setQueue(fixture.plans);
  await listen(createReceiverServer(receiver, { demoMerge: fixture.merge, demoLinks }), firstPort + index);
  console.log(`${mode}：http://127.0.0.1:${firstPort + index}/ · 独立虚构仓库，执行真实 Git`);
}
