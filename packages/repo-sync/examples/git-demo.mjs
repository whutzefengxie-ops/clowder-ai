import { Receiver } from '../src/engine.mjs';
import { createReceiverServer, listen } from '../src/server.mjs';
import { repositories } from '../test/fixtures.mjs';

const fixture = await repositories();
const receiver = new Receiver(fixture.config);
await receiver.adopt(fixture.u0, fixture.i0);
await receiver.setQueue(fixture.plans);
await listen(
  createReceiverServer(receiver, { demoMerge: fixture.merge }),
  Number(process.env.REPO_SYNC_GIT_PORT ?? 5187),
);
console.log(`合成仓库、真实 Git 接收演示：http://127.0.0.1:${process.env.REPO_SYNC_GIT_PORT ?? 5187}`);
