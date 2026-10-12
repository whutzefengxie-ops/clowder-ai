import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail } from './config.mjs';

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.path = join(directory, 'ledger.json');
    this.lockPath = join(directory, 'writer.lock');
  }
  async read() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      fail('LEDGER_UNREADABLE', '台账损坏或无法读取，暂停；不可自动创建空台账覆盖');
    }
  }
  async save(state) {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
  async locked(action) {
    await mkdir(this.directory, { recursive: true });
    const token = randomUUID();
    let handle;
    try {
      const { open } = await import('node:fs/promises');
      handle = await open(this.lockPath, 'wx', 0o600);
    } catch (error) {
      if (error.code === 'EEXIST')
        fail('WRITER_LOCKED', '已有执行器锁；不按租约超时接管。核对旧进程已退出后执行 unlock。');
      throw error;
    }
    await handle.writeFile(JSON.stringify({ token, pid: process.pid }));
    await handle.close();
    try {
      return await action();
    } finally {
      const owner = JSON.parse(await readFile(this.lockPath, 'utf8'));
      if (owner.token !== token) fail('LOCK_OWNER_CHANGED', '执行器锁归属改变，停止释放');
      await unlink(this.lockPath);
    }
  }
  async unlock(writersStopped = false) {
    if (!writersStopped) fail('WRITERS_NOT_CONFIRMED', '先确认旧执行器及其 Git/检查子进程均已退出，再显式解锁');
    const owner = JSON.parse(await readFile(this.lockPath, 'utf8'));
    try {
      process.kill(owner.pid, 0);
      fail('WRITER_STILL_ALIVE', '旧执行器仍存在，不允许接管');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await unlink(this.lockPath);
  }
}
export function event(state, delivery, message) {
  state.events.push({
    time: new Date().toISOString(),
    deliveryId: delivery?.id ?? null,
    stage: delivery?.status ?? 'CONFIGURATION',
    message,
  });
}
