import { createHash, randomUUID } from 'node:crypto';
import { catRegistry } from '@cat-cafe/shared';
import { validateRuntimeProviderBinding } from '../../../config/account-resolver.js';
import { usesNativeToolConfiguration } from '../../../config/cat-account-binding.js';
import { getCatModel } from '../../../config/cat-models.js';
import { resolveCatRuntimeAccount } from '../../../config/cat-runtime-account.js';
import { resolveCodexAccountLaunch } from '../../../config/codex-account-launch.js';
import {
  extractUserEnvTemplates,
  hasSupportedEnvTemplate,
  resolveEnvMap,
} from '../../cats/services/agents/providers/env-map.js';
import type { AgentRegistry } from '../../cats/services/agents/registry/AgentRegistry.js';
import type { AgentServiceOptions } from '../../cats/services/types.js';
import { diagnosticDestination } from './plugin-diagnostic-destination.js';

const generations = new WeakMap<object, string>();

export function diagnosticProviders(registry: AgentRegistry, projectRoot: string) {
  return [...registry.getAllEntries()].flatMap(([id, service]) => {
    const config = catRegistry.tryGet(id)?.config;
    if (!config || !['openai', 'anthropic'].includes(config.clientId) || !service.supportsFeedbackDiagnostics?.())
      return [];
    try {
      const client = config.clientId === 'openai' ? 'openai' : 'anthropic';
      const model = getCatModel(id);
      const account = resolveCatRuntimeAccount(projectRoot, id, client, config);
      if (!account && !usesNativeToolConfiguration(config)) return [];
      if (account && validateRuntimeProviderBinding(client, account, model)) return [];
      if (account?.authType === 'api_key' && !account.apiKey) return [];
      const callbackEnv: Record<string, string> =
        client === 'openai'
          ? { CAT_CAFE_OPENAI_MODEL_OVERRIDE: model, ...(account ? { CODEX_AUTH_MODE: account.authType } : {}) }
          : {
              CAT_CAFE_ANTHROPIC_MODEL_OVERRIDE: model,
              CAT_CAFE_ANTHROPIC_PROFILE_MODE: account?.authType === 'api_key' ? 'api_key' : 'subscription',
            };
      if (account?.authType === 'api_key')
        Object.assign(
          callbackEnv,
          resolveEnvMap(
            client,
            undefined,
            {
              apiKey: account.apiKey,
              baseUrl: account.baseUrl,
              baseModel: model,
            },
            extractUserEnvTemplates(account.envVars ?? {}),
          ),
        );
      const options: AgentServiceOptions = {
        callbackEnv,
        ...(account?.claude ? { claudeTokenAccount: true } : {}),
        ...(account
          ? {
              accountEnv: Object.fromEntries(
                Object.entries(account.envVars ?? {}).filter(
                  ([key, value]) =>
                    /^[A-Z_][A-Za-z0-9_]*$/.test(key) &&
                    !key.startsWith('CAT_CAFE_') &&
                    !hasSupportedEnvTemplate(value),
                ),
              ),
            }
          : {}),
        ...(client === 'openai' && account
          ? { codexAccountLaunch: resolveCodexAccountLaunch(account, { cwd: projectRoot }) }
          : {}),
      };
      const destination = diagnosticDestination(client, account, { ...callbackEnv, ...options.accountEnv });
      const generation = generations.get(service) ?? randomUUID();
      generations.set(service, generation);
      const revision = createHash('sha256')
        .update(JSON.stringify({ id, generation, model, destination, options }))
        .digest('hex');
      return [
        {
          id,
          label: config.displayName,
          provider: `${client} 兼容协议`,
          destination,
          revision,
          model,
          service,
          options,
        },
      ];
    } catch {
      return [];
    }
  });
}
