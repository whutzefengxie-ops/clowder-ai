import { dirname, resolve } from 'node:path';
import { type CatConfig, catRegistry, resolveL0Projections } from '@cat-cafe/shared';
import { captureFrozenL0Input } from '@cat-cafe/shared/l0-input-capture';
import { getCoCreatorConfig, isCatAvailable, loadResolvedCatConfig } from '../../../../../config/cat-config-loader.js';
import { getCatModel } from '../../../../../config/cat-models.js';
import { resolveProjectTemplatePath } from '../../../../../config/project-template-path.js';
import { resolveActiveProjectRoot } from '../../../../../utils/active-project-root.js';
import { loadCompiledGovernanceL0Sync } from '../../context/governance-l0.js';
import { FileProfileRepository } from '../../profile/ProfileRepository.js';
import { resolveL0CompilerScriptPath } from './l0-compiler.js';

/** Called synchronously by the admission/control owner before any provider lease or send. */
export function captureInvocationL0Input(input: {
  catId: string;
  catConfig: CatConfig;
  userId: string;
  model?: string;
  projectRoot?: string;
  profileRepository?: Pick<FileProfileRepository, 'profileDir'>;
  projection?: 'owner' | 'public';
}) {
  const projection = input.projection ?? 'owner';
  if (!resolveL0Projections().includes(projection)) throw new Error(`Unsupported L0 projection: ${projection}`);
  const script = resolveL0CompilerScriptPath();
  if (!script) throw new Error('Frozen L0 compiler installation is unavailable');
  const installRoot = resolve(dirname(script), '..');
  const projectRoot = input.projectRoot ?? resolveActiveProjectRoot();
  const catalog = loadResolvedCatConfig(resolveProjectTemplatePath(resolveActiveProjectRoot()));
  const configs = catRegistry.getAllConfigs();
  return captureFrozenL0Input({
    catId: input.catId,
    member: input.catConfig,
    model: projection === 'public' ? '' : (input.model ?? getCatModel(input.catId)),
    teammates:
      projection === 'public'
        ? []
        : Object.entries(configs)
            .filter(([id]) => isCatAvailable(id, catalog))
            .map(([id, config]) => ({ catId: id, config, model: getCatModel(id) })),
    coCreator: projection === 'public' ? { name: '', mentionPatterns: [] } : getCoCreatorConfig(catalog),
    installRoot,
    projectRoot,
    projection,
    ...(projection === 'owner'
      ? {
          profileDir: (input.profileRepository ?? new FileProfileRepository()).profileDir(input.userId),
          governanceText: loadCompiledGovernanceL0Sync(installRoot).content,
        }
      : {}),
  });
}
