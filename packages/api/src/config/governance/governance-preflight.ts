/**
 * F070: Governance Preflight Gate
 *
 * Fail-closed check before dispatching to external projects.
 * Verifies governance pack has been bootstrapped, confirmed,
 * AND actual governance files exist on disk for the target provider.
 */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSameProject } from '../../utils/monorepo-root.js';
import type { Provider } from './governance-pack.js';
import { MANAGED_BLOCK_START } from './governance-pack.js';
import { GovernanceRegistry } from './governance-registry.js';

export interface PreflightResult {
  ready: boolean;
  reason?: string;
}

/** Map CatProvider (shared type) to governance Provider */
const CAT_PROVIDER_MAP: Record<string, Provider> = {
  anthropic: 'claude',
  openai: 'codex',
  google: 'gemini',
};

/** Provider → config file name */
const PROVIDER_CONFIG_FILE: Record<Provider, string> = {
  claude: 'CLAUDE.md',
  codex: 'AGENTS.md',
  gemini: 'GEMINI.md',
};

/** Provider → skills directory */
const PROVIDER_SKILLS_DIR: Record<Provider, string> = {
  claude: '.claude/skills',
  codex: '.codex/skills',
  gemini: '.gemini/skills',
};

/**
 * Check if an external project is ready for cat dispatch.
 *
 * @param catProvider - The CatProvider of the cat being dispatched (e.g. 'anthropic').
 *   When provided, checks the specific provider's config file + skills dir.
 *   When omitted, checks CLAUDE.md + any one skills symlink (backward compat).
 */
export async function checkGovernancePreflight(
  projectPath: string,
  catCafeRoot: string,
  catProvider?: string,
): Promise<PreflightResult> {
  // Not an external project — always pass
  if (isSameProject(projectPath, catCafeRoot)) {
    return { ready: true };
  }

  const registry = new GovernanceRegistry(catCafeRoot);
  const entry = await registry.get(projectPath);

  if (!entry) {
    return {
      ready: false,
      reason: `Governance not bootstrapped for ${projectPath}. Use POST /api/governance/confirm to bootstrap.`,
    };
  }

  if (!entry.confirmedByUser) {
    return {
      ready: false,
      reason: `Governance bootstrap pending confirmation for ${projectPath}.`,
    };
  }

  // Resolve provider-specific files to check
  const govProvider = catProvider ? CAT_PROVIDER_MAP[catProvider] : undefined;
  const configFile = govProvider ? PROVIDER_CONFIG_FILE[govProvider] : 'CLAUDE.md';
  const skillsDirs = govProvider
    ? [PROVIDER_SKILLS_DIR[govProvider]]
    : ['.claude/skills', '.codex/skills', '.gemini/skills'];

  // Filesystem: verify provider config file has managed block
  try {
    const content = await readFile(join(projectPath, configFile), 'utf-8');
    if (!content.includes(MANAGED_BLOCK_START)) {
      return {
        ready: false,
        reason: `${configFile} missing governance managed block in ${projectPath}.`,
      };
    }
  } catch {
    return {
      ready: false,
      reason: `${configFile} not found in ${projectPath}. Governance bootstrap may have failed.`,
    };
  }

  // Filesystem: skills symlink for the target provider (or any if no provider specified)
  let hasSkillsLink = false;
  for (const dir of skillsDirs) {
    try {
      const stat = await lstat(join(projectPath, dir));
      if (stat.isSymbolicLink()) {
        hasSkillsLink = true;
        break;
      }
    } catch {
      // continue
    }
  }
  if (!hasSkillsLink) {
    const dirLabel = govProvider ? PROVIDER_SKILLS_DIR[govProvider] : 'skills';
    return {
      ready: false,
      reason: `No ${dirLabel} symlink in ${projectPath}. Governance bootstrap may have failed.`,
    };
  }

  return { ready: true };
}
