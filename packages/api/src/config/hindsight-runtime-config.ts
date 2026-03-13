import type { ConfigSnapshot } from './config-snapshot.js';
import { parseBoolean, parseCsvEnumList, parseEnum, parseIntInRange } from './parse-utils.js';

type RecallBudget = ConfigSnapshot['hindsight']['recallDefaults']['budget'];
type RecallTagsMatch = ConfigSnapshot['hindsight']['recallDefaults']['tagsMatch'];
type ReflectDispositionMode = ConfigSnapshot['hindsight']['reflect']['dispositionMode'];
type FreshnessStatus = ConfigSnapshot['hindsight']['freshnessGuard']['failClosedStatuses'][number];

export interface ParsedHindsightRuntimeConfig {
  recallDefaults: {
    budget: RecallBudget;
    tagsMatch: RecallTagsMatch;
    limit: number;
  };
  reflect: {
    dispositionMode: ReflectDispositionMode;
  };
  freshnessGuard: {
    failClosedEnabled: boolean;
    failClosedStatuses: FreshnessStatus[];
    autoReimportEnabled: boolean;
    autoReimportCooldownMs: number;
    autoReimportCommand: string;
  };
}

export function parseHindsightRuntimeConfig(env: NodeJS.ProcessEnv): ParsedHindsightRuntimeConfig {
  return {
    recallDefaults: {
      budget: parseEnum<RecallBudget>(env.HINDSIGHT_RECALL_DEFAULT_BUDGET, ['low', 'mid', 'high'], 'mid'),
      tagsMatch: parseEnum<RecallTagsMatch>(
        env.HINDSIGHT_RECALL_DEFAULT_TAGS_MATCH,
        ['all_strict', 'any_strict', 'all', 'any'],
        'all_strict',
      ),
      limit: parseIntInRange(env.HINDSIGHT_RECALL_DEFAULT_LIMIT, 5, 1, 20),
    },
    reflect: {
      dispositionMode: parseEnum<ReflectDispositionMode>(
        env.HINDSIGHT_REFLECT_DISPOSITION_MODE,
        ['off', 'template_only'],
        'template_only',
      ),
    },
    freshnessGuard: {
      failClosedEnabled: parseBoolean(env.HINDSIGHT_P0_FAIL_CLOSED_ENABLED, true),
      failClosedStatuses: parseCsvEnumList(
        env.HINDSIGHT_P0_FAIL_CLOSED_STATUSES,
        ['fresh', 'stale', 'unknown'],
        ['stale'],
      ) as FreshnessStatus[],
      autoReimportEnabled: parseBoolean(env.HINDSIGHT_P0_AUTO_REIMPORT_ENABLED, true),
      autoReimportCooldownMs: parseIntInRange(env.HINDSIGHT_P0_AUTO_REIMPORT_COOLDOWN_MS, 600000, 1000, 86400000),
      autoReimportCommand:
        env.HINDSIGHT_P0_AUTO_REIMPORT_COMMAND?.trim() || 'pnpm --filter @cat-cafe/api hindsight:import:p0 -- --all',
    },
  };
}
