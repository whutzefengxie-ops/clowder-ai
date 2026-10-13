import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const source = resolve(process.argv[2] ?? '../../.research-20261013-codex-acp');
const target = resolve('.cat-cafe/tmp/acp-prototypes/codex');
const pin = '51f78d67e46c3a96ee8d8bf4e43fc917ab21c73e';
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== pin)
  throw new Error('Codex upstream pin mismatch');
await mkdir(target, { recursive: true });
for (const file of ['src', 'package.json', 'package-lock.json', 'tsconfig.json', 'build.mjs', 'vitest.config.ts']) {
  try {
    await cp(join(source, file), join(target, file), { recursive: true });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
await cp('scripts/acp-spikes/codex-native-fence.ts', join(target, 'src/ClowderNativeFence.ts'));
await cp('scripts/acp-spikes/codex-bridge-extension.test.template.ts', join(target, 'src/__tests__/clowder-fence.test.ts'));
const file = join(target, 'src/CodexAcpServer.ts');
let text = await readFile(file, 'utf8');
text = "import { CodexNativeFence } from './ClowderNativeFence';\n" + text;
text = text.replace(
  '    async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {',
  `    private readonly clowderFence = new CodexNativeFence(sessionId => this.getSessionState(sessionId), { steerTurn: params => this.codexAcpClient.steerTurn(params) });
    async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (method === '_clowder/v1/control') return this.clowderFence.handle(params);`,
);
if (!text.includes('return this.clowderFence.handle(params)')) throw new Error('Bridge extension hook missing');
await writeFile(file, text);
console.log(
  JSON.stringify({
    source,
    target,
    upstream: pin,
    extension: '_clowder/v1/control',
    scope: 'W4.P not production',
    nativeVerification: 'pending',
  }),
);
