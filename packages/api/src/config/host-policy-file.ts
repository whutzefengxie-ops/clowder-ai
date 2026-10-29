import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { type DeploymentHostPolicy, deploymentDefaults, parseDeploymentHostPolicy } from '@cat-cafe/shared';
import { resolveAcpHostPolicy } from './acp-host-policy.js';

/** Read-only: a missing owner file inherits; malformed or unreadable input stops startup. */
export function readHostPolicyFile(path: string | undefined): DeploymentHostPolicy {
  if (path === undefined) return {};
  if (!isAbsolute(path)) throw new Error('CAT_CAFE_HOST_POLICY_FILE must be an absolute path; fix it and restart API');
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Cannot read Host policy file ${path}; fix access and restart API`, { cause: error });
  }
  try {
    return parseDeploymentHostPolicy(JSON.parse(text.replace(/^\uFEFF/, '')));
  } catch {
    throw new Error(`Invalid Host policy file ${path}; use only bootstrapMode and auditMode, then restart API`);
  }
}

export function loadAcpHostPolicy(
  policyEnv: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  preset = deploymentDefaults.hostPolicy,
) {
  const ownerFile = policyEnv.CAT_CAFE_HOST_POLICY_FILE;
  const owner = readHostPolicyFile(ownerFile);
  return {
    ...resolveAcpHostPolicy(policyEnv, platform, { owner, preset }),
    ...(ownerFile === undefined ? {} : { ownerFile }),
  };
}
