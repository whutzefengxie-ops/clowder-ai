import { resolveCliCommand } from '../utils/cli-resolve.js';

const INTRANET_ROLES = [
  { id: 'ragdoll', nickname: '宪宪' },
  { id: 'maine-coon', nickname: '砚砚' },
  { id: 'turkish-van', nickname: '墨墨' },
] as const;

/** Built into the Host: PATH/file discovery only, no plugin, credentials, prompt or agent process. */
export function discoverCodeAgentRuntimes(
  commandFor: typeof resolveCliCommand = resolveCliCommand,
  intranet = process.env.CAT_CAFE_INTRANET_EDITION === '1',
) {
  const command = commandFor('codeagent');
  const roles = intranet ? INTRANET_ROLES : [{ id: 'ragdoll', nickname: '宪宪' }];
  return roles.map((role) => ({
    id: `codeagent:${role.id}`,
    label: intranet ? `CodeAgent · ${role.nickname}` : 'CodeAgent',
    clientId: 'acp' as const,
    roleTemplateId: role.id,
    priority: intranet ? 100 : 0,
    installed: Boolean(command),
    command: command ?? undefined,
    ...(command ? { acp: { command, startupArgs: ['--acp'], transport: 'stdio' as const } } : {}),
    discoveryStatus: command ? ('configured' as const) : ('not_installed' as const),
    models: [] as string[],
    defaultsStatus: 'session_only' as const,
    transport: 'acp',
  }));
}
