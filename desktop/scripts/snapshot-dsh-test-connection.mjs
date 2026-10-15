import fs from 'node:fs';
import path from 'node:path';

/** Explicit local acceptance setup, never called by production discovery or the installer. */
export function snapshotDshTestConnection({ sourceHome, targetHome, npmCache }) {
  if (path.resolve(sourceHome) === path.resolve(targetHome)) throw new Error('DSH test home must be separate');
  const copied = [];
  for (const relative of [
    'profiles/acp/package.json',
    'profiles/acp/cordis.yml',
    'profiles/acp/cordis.patch.yml',
    'profiles/acp/pnpm-workspace.yaml',
    'llm-deepseek/files-v3.json',
  ]) {
    const from = path.join(sourceHome, '.dsh', relative),
      to = path.join(targetHome, '.dsh', relative);
    if (!fs.existsSync(from)) continue;
    if (!fs.lstatSync(from).isFile()) throw new Error('DSH connection must be an ordinary file');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    try {
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      copied.push(relative);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  // Detection reads this cache; ACP invokes the resolved Node entry directly (never npx).
  // The actual installed CLI stays outside app data, just like an existing PATH executable.
  const from = path.join(npmCache, '_npx'),
    to = path.join(targetHome, 'AppData/Local/npm-cache/_npx');
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.symlinkSync(path.resolve(from), to, process.platform === 'win32' ? 'junction' : 'dir');
  }
  return { copied, sourceModified: false, sessionsCopied: false, existingConfigurationReplaced: false };
}
