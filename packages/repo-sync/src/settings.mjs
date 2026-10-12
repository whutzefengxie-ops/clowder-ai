import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fail, validateConfig } from './config.mjs';
import { Receiver } from './engine.mjs';

export async function configuredReceiver(config) {
  let settings;
  try {
    settings = JSON.parse(await readFile(join(config.stateDir, 'sync-settings.json'), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') fail('SETTINGS_UNREADABLE', '本地模式设置无法读取，暂停；不能自动恢复默认值');
  }
  if (settings && (settings.schema !== 1 || !['continuous', 'version'].includes(settings.mode)))
    fail('SETTINGS_UNREADABLE', '本地模式设置格式无效');
  const receiver = new Receiver(
    settings
      ? { ...config, mode: settings.mode, internalPaths: settings.internalPaths, mergePaths: settings.mergePaths }
      : config,
  );
  if (config.mode && config.mode !== receiver.config.mode)
    fail('MODE_CONFLICT', '私有配置模式与已保存模式不同，请核对配置或使用独立台账目录');
  if (
    settings &&
    (config.internalPaths || config.mergePaths) &&
    validateConfig(config).bindingId !== receiver.config.bindingId
  )
    fail('MODE_CONFLICT', '私有配置文件规则与已保存规则不同，请核对后使用原规则或独立台账');
  await receiver.read();
  return receiver;
}
export async function configure(receiver, input) {
  return receiver.store.locked(async () => {
    if (!['continuous', 'version'].includes(input.mode)) fail('INVALID_MODE', '请选择同步模式');
    if (await receiver.read())
      fail('ALREADY_ADOPTED', '已启用绑定不能更换模式或文件规则，请为另一种模式配置独立台账目录');
    const settings = { schema: 1, mode: input.mode, internalPaths: input.internalPaths, mergePaths: input.mergePaths };
    const next = new Receiver({ ...receiver.config, ...settings });
    const path = join(receiver.config.stateDir, 'sync-settings.json');
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(settings)}\n`, { mode: 0o600 });
    await rename(temporary, path);
    return next;
  });
}
