const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const targets = {
  'deploy-api': ['packages/api', 'dist/index.js'],
  'deploy-web': ['packages/web', '.next/BUILD_ID'],
  'deploy-mcp-server': ['packages/mcp-server', 'dist/index.js'],
  electron: ['desktop-dist', 'Clowder AI.exe'],
};

async function extractRuntimeArchive(installRoot, archiveName, tarImplementation) {
  const root = path.resolve(installRoot);
  const name = archiveName.replace(/\.tar\.gz$/, '');
  if (!targets[name] || archiveName !== `${name}.tar.gz`) throw new Error('Unknown runtime archive');
  const tar = tarImplementation ?? createRequire(path.join(root, 'node/node_modules/npm/bin/npm-cli.js'))('tar');
  const cwd = path.join(root, targets[name][0]);
  fs.mkdirSync(cwd, { recursive: true });
  await tar.x({
    file: path.join(root, 'bundled/archives', archiveName),
    cwd,
    strict: true,
    filter: (entry) => {
      const target = path.resolve(cwd, entry);
      if (target !== cwd && !target.startsWith(cwd + path.sep))
        throw new Error('Archive entry escapes runtime directory');
      return true;
    },
  });
  if (!fs.existsSync(path.join(cwd, targets[name][1]))) throw new Error(`Incomplete runtime archive: ${name}`);
}

module.exports = { extractRuntimeArchive };
if (require.main === module) {
  const [root, name] = process.argv.slice(2);
  const logs = path.join(root, '.installer-logs');
  fs.mkdirSync(logs, { recursive: true });
  const log = path.join(logs, 'extract-runtime.log');
  const started = Date.now();
  extractRuntimeArchive(root, name)
    .then(() => {
      fs.appendFileSync(
        log,
        JSON.stringify({ archive: name, status: 'complete', elapsedMs: Date.now() - started }) + '\n',
      );
    })
    .catch((error) => {
      fs.appendFileSync(log, JSON.stringify({ archive: name, status: 'failed', message: error.message }) + '\n');
      console.error(error.message);
      process.exitCode = 1;
    });
}
