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
await cp(
  'scripts/acp-spikes/codex-bridge-extension.test.template.ts',
  join(target, 'src/__tests__/clowder-fence.test.ts'),
);
const file = join(target, 'src/CodexAcpServer.ts');
let text = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
text = "import { CodexNativeFence } from './ClowderNativeFence';\n" + text;
text = text.replace(
  '    async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {',
  `    private readonly clowderFence = new CodexNativeFence(sessionId => this.getSessionState(sessionId), { steerTurn: params => this.codexAcpClient.steerTurn(params) });
    async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
        if (method === '_clowder/v1/control') {
            try { return await this.clowderFence.handle(params); }
            catch (error) { throw new RequestError(-32600, error instanceof Error ? error.message : 'control_failed'); }
        }`,
);
if (!text.includes('return await this.clowderFence.handle(params)')) throw new Error('Bridge extension hook missing');
await writeFile(file, text);
const entry = join(target, 'src/index.ts');
let entryText = await readFile(entry, 'utf8');
const routeAnchor =
  '.onRequest(SESSION_STEERING_METHOD, sessionSteerParamsParser, (ctx) => getAgent().extMethod(SESSION_STEERING_METHOD, ctx.params))';
if (!entryText.includes(routeAnchor)) throw new Error('ACP wire route anchor missing');
entryText = entryText.replace(
  routeAnchor,
  `${routeAnchor}\n        .onRequest('_clowder/v1/control', z.record(z.string(), z.unknown()), (ctx) => getAgent().extMethod('_clowder/v1/control', ctx.params))`,
);
await writeFile(entry, entryText);
const turnAnchor = 'sessionState.currentTurnId = turnId;';
const metaAnchor = '            _meta: {\n                steering: {';
if (!text.includes(metaAnchor)) throw new Error('Codex capability anchor missing');
text = text.replace(
  metaAnchor,
  `            _meta: {
                _clowder: { controlV1: { prototype: true, version: 1, method: '_clowder/v1/control', nativeIdMethod: '_clowder/v1/turn_started' } },
                steering: {`,
);
text = text.replaceAll(
  turnAnchor,
  `${turnAnchor}\n                    void this.connection.notify('_clowder/v1/turn_started', {sessionId: sessionState.sessionId, nativeSessionId: sessionState.sessionId, nativeTurnId: turnId}).catch(error => logger.log('Clowder native ID export failed', {error: String(error)}));`,
);
await writeFile(file, text);
const loggerFile = join(target, 'src/Logger.ts');
let loggerText = await readFile(loggerFile, 'utf8');
loggerText = loggerText.replace(
  'fs.appendFileSync(this.logFilePath, `${line}\\n`);',
  `const redactionPath = process.env['CLOWDER_TRACE_REDACTIONS_FILE'];
            let safeLine = line;
            if (redactionPath) for (const secret of JSON.parse(fs.readFileSync(redactionPath, 'utf8')) as unknown[]) {
                if (typeof secret === 'string' && secret.length > 15) safeLine = safeLine.split(secret).join('[redacted]');
            }
            fs.appendFileSync(this.logFilePath, safeLine + '\\n');`,
);
await writeFile(loggerFile, loggerText);
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
