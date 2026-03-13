/**
 * F32-b P4d: Resolve breedId for a catName.
 * Tries catRegistry first (dynamic, includes variants), falls back to
 * static CAT_CONFIGS (always available, no async dependency).
 */
import { CAT_CONFIGS, catRegistry } from '@cat-cafe/shared';

export function resolveBreedId(catName: string): string | undefined {
  const entry = catRegistry.tryGet(catName);
  if (entry?.config.breedId) return entry.config.breedId;
  return CAT_CONFIGS[catName]?.breedId;
}
