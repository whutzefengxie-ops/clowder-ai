import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { resolveCliCommand } from '../utils/cli-resolve.js';

function metadata(file: string, toml = false): Record<string, unknown> {
  try {
    const raw = readFileSync(file, 'utf8');
    const value: unknown = toml ? parse(raw) : JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

/** Reads only model identifiers; credentials and full configs never leave this boundary. */
export function discoverAdditionalRuntimes(home: string, commandFor: typeof resolveCliCommand = resolveCliCommand) {
  const kimi = metadata(
    process.env.KIMI_CONFIG_FILE ||
      join(
        process.env.KIMI_SHARE_DIR ||
          join(home, existsSync(join(home, '.kimi-code/config.toml')) ? '.kimi-code' : '.kimi'),
        'config.toml',
      ),
    true,
  );
  const opencode = metadata(
    process.env.OPENCODE_CONFIG ||
      join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode', 'opencode.json'),
  );
  const native = (
    [
      ['kimi', 'Kimi', kimi, text(kimi.default_model)],
      ['opencode', 'OpenCode', opencode, text(opencode.model)],
    ] as const
  ).map(([id, label, config, configuredModel]) => {
    const command = commandFor(id);
    const models = new Set(configuredModel ? [configuredModel] : []);
    if (id === 'kimi' && config.models && typeof config.models === 'object')
      for (const model of Object.keys(config.models)) models.add(model);
    return {
      id,
      label,
      clientId: id,
      command: command ?? undefined,
      installed: Boolean(command),
      configuredModel,
      models: [...models],
      defaultsStatus: 'configured_only',
      transport: id === 'kimi' ? 'stream_json' : 'json',
    };
  });
  const pi = commandFor('pi');
  const bridge = commandFor('pi-acp');
  return [
    ...native,
    {
      id: 'pi',
      label: 'Pi',
      clientId: 'acp',
      installed: Boolean(pi),
      command: bridge ?? undefined,
      ...(bridge && pi ? { acp: { command: bridge, startupArgs: [], transport: 'stdio' as const } } : {}),
      discoveryStatus: !pi ? 'not_installed' : bridge ? 'configured' : 'adapter_missing',
      models: [],
      defaultsStatus: 'session_only',
      transport: 'acp',
    },
  ];
}
