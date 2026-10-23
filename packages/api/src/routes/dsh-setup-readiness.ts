import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { isMap, isScalar, parseDocument } from 'yaml';
import { dshProviderCredentialReferences, inspectDshConfig } from './dsh-setup-config.js';

function read(path: string): string {
  try {
    if (statSync(path).size > 4_000_000) throw Error('dsh_config_invalid');
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw Error('dsh_setup_credential_unavailable');
  }
}
/** Inspect presence only; never copy credentials into a patch, response, or child environment. */
export function inspectDshRouteReadiness(source: string, home: string, cwd: string, env = process.env) {
  const document = parseDocument(read(join(home, '.credentials.yaml')), { uniqueKeys: true });
  if (document.errors.length) throw Error('dsh_setup_credential_unavailable');
  const root = document.contents;
  const version: unknown = isMap(root) ? root.get('version') : undefined;
  if (isMap(root) && root.has('version') && version !== 1) throw Error('dsh_setup_credential_unavailable');
  const refs = isMap(root) ? (root.has('version') ? root.get('refs', true) : root) : undefined;
  const records = isMap(root) ? root.get('records', true) : undefined;
  const dotenv = { ...parseEnv(read(join(home, '.env'))), ...parseEnv(read(join(cwd, '.env'))) };
  const present = (name: string) => {
    const value = isMap(refs) ? refs.get(name, true) : undefined;
    return Boolean((isScalar(value) && typeof value.value === 'string' && value.value) || env[name] || dotenv[name]);
  };
  const references = dshProviderCredentialReferences(source);
  return {
    ...inspectDshConfig(source),
    providers: inspectDshConfig(source).providers.map((provider) => {
      const reference = references[provider.id];
      const record = isMap(records) ? records.get(`llm-pi-ai/${provider.id}`, true) : undefined;
      const key = isMap(record) && record.get('kind') === 'api-key' ? record.get('key') : undefined;
      const ambient = (
        {
          deepseek: 'DEEPSEEK_API_KEY',
          'deepseek-official': 'DEEPSEEK_API_KEY',
          openai: 'OPENAI_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
        } as Record<string, string>
      )[provider.id];
      const configured = reference
        ? present(reference)
        : Boolean(typeof key === 'string' && key) || Boolean(ambient && present(ambient));
      return { ...provider, credentialStatus: configured ? ('configured' as const) : ('missing' as const) };
    }),
  };
}
