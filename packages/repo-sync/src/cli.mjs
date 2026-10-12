import { readFile } from 'node:fs/promises';
import { discover } from './github.mjs';
import { createReceiverServer, listen } from './server.mjs';
import { configuredReceiver } from './settings.mjs';

const [operation, configPath, ...args] = process.argv.slice(2);
try {
  if (!configPath)
    throw new Error(
      '用法：node packages/repo-sync/src/cli.mjs <status|adopt|discover|tags|select-tag|start|issue|prepare|resolve|cancel-version|pr|recover|receipts|serve|unlock> <私有配置.json> [参数]',
    );
  const receiver = await configuredReceiver(JSON.parse(await readFile(configPath, 'utf8')));
  const actions = {
    status: () => receiver.status(),
    adopt: () => receiver.adopt(args[0], args[1]),
    discover: () => discover(receiver),
    start: () => receiver.start(),
    issue: () => receiver.linkIssue(args[0], args[1], args[2]),
    prepare: () => receiver.prepare(),
    pr: () => receiver.linkPr(args[0]),
    recover: () => receiver.recover(),
    receipts: async () => receiver.receipts(JSON.parse(await readFile(args[0], 'utf8'))),
    unlock: () => receiver.store.unlock(args[0] === '--confirm-no-writers'),
    tags: () => receiver.tags(),
    'select-tag': () => receiver.selectTag(args[0]),
    'cancel-version': () => receiver.cancelVersion(),
    resolve: async () => receiver.resolve(args[0], args[1], args[2] ? await readFile(args[2], 'utf8') : undefined),
    serve: async () => {
      const port = Number(args[0] ?? 5187);
      await listen(createReceiverServer(receiver), port);
      console.log(`Git 接收工具：http://127.0.0.1:${port}`);
    },
  };
  if (!Object.hasOwn(actions, operation)) throw new Error('未知命令');
  const result = await actions[operation]();
  if (operation !== 'serve') console.log(JSON.stringify(result ?? { ok: true }, null, 2));
} catch (error) {
  console.error(`${error.code ?? 'CONFIGURATION_ERROR'}: ${error.message}`);
  process.exitCode = 1;
}
