import fs from 'node:fs';
import path from 'node:path';
import { appGlobalCssFiles } from '../../packages/web/scripts/sync-vendor-assets.mjs';
import { recompressPng } from './recompress-png.mjs';

/** Generated public/vendor and serviceworker files are not in git's source inventory. */
export function stageBuiltWeb(source, destination) {
  for (const file of appGlobalCssFiles) {
    const asset = path.join(source, 'public/vendor/app', file);
    if (!fs.existsSync(asset) || !fs.statSync(asset).size) throw new Error(`Missing built Web CSS asset: ${file}`);
  }
  if (!fs.existsSync(path.join(source, '.next/BUILD_ID'))) throw new Error('Missing Web build identity');
  const buildCaches = new Set(
    ['webpack', 'eslint', '.tsbuildinfo'].map((name) => path.resolve(source, '.next/cache', name)),
  );
  const copy = (from, to) =>
    fs.cpSync(from, to, {
      recursive: true,
      filter: (entry) => {
        if (buildCaches.has(path.resolve(entry))) return false;
        if (fs.lstatSync(entry).isSymbolicLink()) throw new Error('Linked Web build asset');
        return true;
      },
    });
  copy(path.join(source, 'public'), path.join(destination, 'public'));
  fs.readdirSync(path.join(destination, 'public'), { recursive: true })
    .filter((file) => /^avatars[\\/].+\.png$/i.test(file))
    .forEach((file) => {
      const target = path.join(destination, 'public', file);
      const original = fs.readFileSync(target);
      const compressed = recompressPng(original);
      if (compressed !== original) fs.writeFileSync(target, compressed);
    });
  copy(path.join(source, '.next'), path.join(destination, '.next'));
}
