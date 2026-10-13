import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const source = resolve(process.argv[2] ?? '../../.research-20261012-client-comparison/claude-agent-acp');
const target = resolve('.cat-cafe/tmp/acp-prototypes/claude');
const pin = 'd0aafb1ca26427285ffaeac8d8a4452fff28e9c3';
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== pin)
  throw new Error('Claude upstream pin mismatch');
await mkdir(target, { recursive: true });
for (const file of ['src', 'package.json', 'package-lock.json', 'tsconfig.json'])
  await cp(join(source, file), join(target, file), { recursive: true });
await cp('scripts/acp-spikes/claude-next-boundary.test.template.ts', join(target, 'src/tests/clowder-next-boundary.test.ts'));
if (process.argv.includes('--patch-next')) {
  const file = join(target, 'src/acp-agent.ts');
  let text = await readFile(file, 'utf8');
  text = text.replace(
    '    idleBehavior?: "promptRequired";',
    '    idleBehavior?: "promptRequired";\n    delivery?: "next";',
  );
  text = text.replace(
    'userMessage.priority = STEER_PRIORITY;',
    'userMessage.priority = params._meta?.steering?.delivery === "next" ? "next" : STEER_PRIORITY;',
  );
  await writeFile(file, text);
}
console.log(
  JSON.stringify({
    source,
    target,
    upstream: pin,
    patch: process.argv.includes('--patch-next')
      ? 'next-only backport for falsification; pending human safety NOT implemented'
      : 'unpatched baseline',
    nativeVerification: 'pending',
    productionEnabled: false,
  }),
);
