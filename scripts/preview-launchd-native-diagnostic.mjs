import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform !== 'darwin') process.exit(0);
const root = mkdtempSync(join(tmpdir(), 'preview-identity-witness-'));
const label = `com.catcafe.identity-witness.${process.pid}`;
const target = `gui/${process.getuid()}/${label}`;
const program = join(root, 'witness.mjs');
writeFileSync(program, 'setInterval(()=>{},1000);');
const expected = [process.execPath, program, '--test-literal={"a":"space here"}'];
const xml = (value) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const plist = join(root, 'witness.plist');
writeFileSync(
  plist,
  `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${expected.map((value) => `<string>${xml(value)}</string>`).join('')}</array><key>RunAtLoad</key><true/></dict></plist>`,
);
try {
  const start = spawnSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist], { encoding: 'utf8' });
  if (start.status !== 0) throw Error(start.stderr);
  for (let i = 0; i < 12; i++) {
    const job = spawnSync('launchctl', ['print', target], { encoding: 'utf8' });
    const pid = job.stdout.match(/^\s*pid = (\d+)\s*$/m)?.[1];
    const actual = pid
      ? spawnSync('ps', ['-ww', '-p', pid, '-o', 'lstart=,command='], {
          encoding: 'utf8',
          env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' },
        }).stdout.trim()
      : null;
    console.log(JSON.stringify({ expected: expected.join(' '), pid, actual }));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
} finally {
  spawnSync('launchctl', ['bootout', target], { stdio: 'ignore' });
  rmSync(root, { recursive: true, force: true });
}
