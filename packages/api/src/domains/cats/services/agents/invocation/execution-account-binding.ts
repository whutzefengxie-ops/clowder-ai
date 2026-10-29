import { createHash } from 'node:crypto';
import {
  type CatConfig,
  type CliEffortPreset,
  type CodexSpeedValue,
  type ExecutionAccountSnapshot,
  type ExecutionProfile,
  projectMemberProfiles,
  type RoleProfile,
} from '@cat-cafe/shared';
import type { FrozenL0Input } from '@cat-cafe/shared/l0-input';
import {
  type RuntimeProviderProfile,
  resolveBuiltinClientForProvider,
  validateRuntimeProviderBinding,
} from '../../../../../config/account-resolver.js';
import { AccountStoreVerdictError } from '../../../../../config/account-store-format.js';
import { resolveBoundAccountRefForCat } from '../../../../../config/cat-account-binding.js';
import { resolveCatRuntimeAccount } from '../../../../../config/cat-runtime-account.js';
import { claudeExecutionAccountSnapshot } from '../../../../../config/claude-token-account.js';
import {
  type CodexAccountLaunchDescriptor,
  resolveCodexAccountLaunch,
} from '../../../../../config/codex-account-launch.js';
import { type CodexLaunchPolicy, captureCodexLaunchPolicy } from '../../../../../config/codex-cli.js';
import { codexExecutionAccountSnapshot } from '../../../../../config/codex-execution-account.js';
import { resolveActiveProjectRoot } from '../../../../../utils/active-project-root.js';
import type { AgentServiceOptions } from '../../types.js';
import { hasSupportedEnvTemplate } from '../providers/env-map.js';
import {
  captureMemberExecutionPreferences,
  type MemberExecutionPreferences,
} from '../providers/member-execution-preferences.js';
import type { FrozenExecutionWorkspace } from './execution-workspace.js';

export interface FrozenExecutionBinding {
  readonly openCodeMcpConfig?: import('../providers/opencode-config-writer.js').OpenCodeMcpConfigPlan;
  readonly accountEnv?: Record<string, string>;
  readonly providerOptions?: Readonly<
    Pick<AgentServiceOptions, 'frozenAcpMcpServers' | 'frozenNativeMcpConfig' | 'frozenKimiMcpConfig'>
  >;
  readonly codexLaunchPolicy?: CodexLaunchPolicy;
  readonly threadPreferences?: Readonly<{
    reasoningEffortOverride?: CliEffortPreset;
    speedOverride?: CodexSpeedValue;
    effortReadFailed: boolean;
    speedReadFailed: boolean;
  }>;
  readonly executionPreferences?: MemberExecutionPreferences;
  readonly frozenL0Input?: FrozenL0Input;
  readonly memberRegistryRevision?: number;
  readonly catConfig?: CatConfig;
  readonly roleProfile?: RoleProfile;
  readonly executionProfile?: ExecutionProfile;
  readonly workspace: FrozenExecutionWorkspace;
  readonly projectRoot: string;
  readonly effectiveAccountRef?: string;
  readonly resolvedAccount: RuntimeProviderProfile | null;
  readonly codexAccountLaunch?: CodexAccountLaunchDescriptor;
  readonly executionAccount?: ExecutionAccountSnapshot;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** In-memory carrier only: never persist credentials in Queue/TurnExecution provenance. */
export function freezeExecutionAccountBinding(input: {
  catId: string;
  catConfig?: CatConfig;
  model?: string;
  workspace: FrozenExecutionWorkspace;
  providerOptions?: FrozenExecutionBinding['providerOptions'];
}): FrozenExecutionBinding {
  const catConfig = input.catConfig ? deepFreeze(structuredClone(input.catConfig)) : undefined;
  const provider = catConfig?.clientId;
  const client = provider ? resolveBuiltinClientForProvider(provider) : null;
  const projectRoot = resolveActiveProjectRoot(process.cwd());
  const effectiveAccountRef = resolveBoundAccountRefForCat(projectRoot, input.catId, catConfig);
  let account: RuntimeProviderProfile | null = null;
  try {
    account = client ? resolveCatRuntimeAccount(projectRoot, input.catId, client, catConfig) : null;
    if (effectiveAccountRef && client && !account) throw new Error(`bound account "${effectiveAccountRef}" not found`);
    const error =
      provider && account
        ? validateRuntimeProviderBinding(provider, account, input.model ?? catConfig?.defaultModel)
        : null;
    if (error) throw new Error(error);
  } catch (error) {
    if (
      error instanceof AccountStoreVerdictError ||
      effectiveAccountRef ||
      (error instanceof Error && /bound provider profile|model ".+" is not available/.test(error.message))
    )
      throw error;
  }
  if (account?.authType === 'api_key' && !account.apiKey)
    throw new Error(
      `account "${account.id}" is configured as api_key but has no API key set — add the key in Hub > account settings`,
    );
  const resolvedAccount = account ? deepFreeze(structuredClone(account)) : null;
  // Preserve F171 filtering. The same selected HOME/environment is used by
  // provider discovery and later invocation; template values remain resolveEnvMap's responsibility.
  const accountEnv = Object.fromEntries(
    Object.entries(resolvedAccount?.envVars ?? {}).filter(
      ([key, value]) =>
        /^[A-Z_][A-Za-z0-9_]*$/.test(key) && !key.startsWith('CAT_CAFE_') && !hasSupportedEnvTemplate(value),
    ),
  );
  const codexAccountLaunch =
    provider === 'openai' && resolvedAccount
      ? resolveCodexAccountLaunch(resolvedAccount, { cwd: input.workspace.workingProjectRoot })
      : undefined;
  const executionAccount =
    resolvedAccount && codexAccountLaunch
      ? codexExecutionAccountSnapshot(resolvedAccount, codexAccountLaunch)
      : provider === 'anthropic' && resolvedAccount?.claude
        ? claudeExecutionAccountSnapshot(resolvedAccount)
        : resolvedAccount
          ? Object.freeze({
              accountRef: resolvedAccount.id,
              displayName: resolvedAccount.displayName ?? resolvedAccount.id,
              authType: resolvedAccount.authType,
              accountRevision: createHash('sha256')
                .update(JSON.stringify({ provider, account: resolvedAccount }))
                .digest('hex'),
            })
          : undefined;
  return Object.freeze({
    catConfig,
    ...(input.providerOptions ? { providerOptions: deepFreeze(input.providerOptions) } : {}),
    ...(provider === 'openai' ? { codexLaunchPolicy: captureCodexLaunchPolicy() } : {}),
    ...(catConfig
      ? { executionPreferences: captureMemberExecutionPreferences(input.catId, catConfig, input.model) }
      : {}),
    ...(catConfig ? deepFreeze(projectMemberProfiles(catConfig)) : {}),
    workspace: input.workspace,
    projectRoot,
    effectiveAccountRef,
    resolvedAccount,
    ...(Object.keys(accountEnv).length > 0 ? { accountEnv: deepFreeze(accountEnv) } : {}),
    ...(codexAccountLaunch ? { codexAccountLaunch } : {}),
    ...(executionAccount ? { executionAccount } : {}),
  });
}
