import type { RuntimeProviderProfile } from '../../../config/account-resolver.js';

/** A client/protocol name is not the model's destination. Never serialize credentials or URL queries. */
export function diagnosticDestination(
  client: 'openai' | 'anthropic',
  account: RuntimeProviderProfile | null,
  env: Record<string, string> = {},
): string {
  if (!account || account.syntheticNative) return '原生客户端配置：实际模型目的地未知，无法核验其变更';
  const value = env[client === 'openai' ? 'OPENAI_BASE_URL' : 'ANTHROPIC_BASE_URL'] ?? account.baseUrl;
  const label = account.displayName ?? account.id;
  if (value) {
    try {
      const url = new URL(value);
      if (!['https:', 'http:'].includes(url.protocol)) return `${label} · 目的地无法核实`;
      return `${label} · ${url.origin}`;
    } catch {
      return `${label} · 目的地无法核实`;
    }
  }
  if (account.authType === 'oauth')
    return `${label} · ${client === 'openai' ? 'https://api.openai.com' : 'https://api.anthropic.com'}（OAuth 默认服务）`;
  return `${label} · 未配置明确地址，实际目的地未知`;
}
