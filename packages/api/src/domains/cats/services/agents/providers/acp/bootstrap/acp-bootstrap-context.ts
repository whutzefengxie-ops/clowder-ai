import { dirname } from 'node:path';
import type { AcpVariantConfig } from '../../../../../../../config/cat-config-loader.js';
import { buildChildEnv } from '../../../../../../../utils/cli-spawn.js';
import type { PoolKey } from '../AcpProcessPool.js';
import { resolveAcpBootstrapArgs, resolveAcpBootstrapCommand, resolveAcpBootstrapCwd } from '../acp-bootstrap-cwd.js';
import { matchStartupPolicy } from './acp-startup-policy-matcher.js';

export interface AcpBootstrapContext {
  projectRoot: string;
  command: string;
  args: string[];
  model?: string;
  poolKey: PoolKey;
}
export interface VerifiedAcpBootstrapContext extends AcpBootstrapContext {
  cwd: string;
  isolation?: string;
  /** Policy ID that matched (W3: for pool signature) */
  policyId?: string;
  /** Policy revision that matched (W3: for pool signature) */
  policyRevision?: number;
  verifyCwd: (command?: string, args?: string[], env?: NodeJS.ProcessEnv) => string;
}
export function resolveAcpBootstrap(
  projectRoot: string,
  profileId: string,
  acpConfig: AcpVariantConfig,
  effectiveModel: string,
): AcpBootstrapContext {
  const model = effectiveModel.trim() || undefined;
  return {
    projectRoot,
    command: resolveAcpBootstrapCommand(projectRoot, acpConfig.command),
    args: resolveAcpBootstrapArgs(projectRoot, acpConfig.startupArgs, { base_model: model, model }),
    model,
    poolKey: { projectPath: projectRoot, providerProfile: profileId },
  };
}

/** Classify the startup policy, then freeze the chosen root for this pool. */
export function verifyAcpBootstrap(
  base: AcpBootstrapContext,
  profileId: string,
  bootstrapRoot?: string,
  env?: Record<string, string>,
): VerifiedAcpBootstrapContext {
  const childEnv = buildChildEnv(env, { workingDirectory: base.projectRoot });
  const policyMatch = matchStartupPolicy(base.command, base.args, childEnv);

  // Legacy isolation mapping
  const isolation = policyMatch.matched ? policyMatch.label : undefined;
  const options = { allowVolumeRootDelete: policyMatch.matched };

  const cwd = resolveAcpBootstrapCwd(
    base.projectRoot,
    profileId,
    bootstrapRoot,
    undefined,
    undefined,
    undefined,
    options,
  );
  const verifyCwd = (
    command = base.command,
    args = base.args,
    verifyEnv = buildChildEnv(env, { workingDirectory: cwd }),
  ) => {
    const recheckMatch = matchStartupPolicy(command, args, verifyEnv);
    if (policyMatch.matched) {
      if (
        !recheckMatch.matched ||
        recheckMatch.policyId !== policyMatch.policyId ||
        recheckMatch.revision !== policyMatch.revision
      ) {
        throw new Error('Windows ACP bootstrap startup policy changed; refusing cold start');
      }
    }
    return resolveAcpBootstrapCwd(base.projectRoot, profileId, dirname(cwd), undefined, undefined, false, options);
  };

  return {
    ...base,
    cwd,
    isolation,
    policyId: policyMatch.matched ? policyMatch.policyId : undefined,
    policyRevision: policyMatch.matched ? policyMatch.revision : undefined,
    verifyCwd,
  };
}
