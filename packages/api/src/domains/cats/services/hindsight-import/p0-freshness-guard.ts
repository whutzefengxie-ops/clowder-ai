import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { parseBoolean, parseCsvEnumList, parseIntInRange } from '../../../../config/parse-utils.js';
import type { P0Freshness } from './p0-watermark.js';

const DEFAULT_REIMPORT_COOLDOWN_MS = 10 * 60 * 1000;
const DEFAULT_REIMPORT_STATE_PATH = 'data/hindsight/p0-reimport-state.json';
const DEFAULT_REIMPORT_COMMAND = 'pnpm --filter @cat-cafe/api hindsight:import:p0 -- --all';

const p0ReimportStateSchema = z.object({
  version: z.literal(1),
  lastTriggeredAt: z.string().datetime(),
  lastFreshnessReason: z.string().min(1),
});

type P0ReimportState = z.infer<typeof p0ReimportStateSchema>;

export interface P0FailClosedSettings {
  enabled: boolean;
  statuses: Array<P0Freshness['status']>;
}

export interface P0ReimportSettings {
  enabled: boolean;
  cooldownMs: number;
  command: string;
}

export interface P0ReimportTriggerResult {
  status: 'triggered' | 'cooldown' | 'skipped' | 'disabled' | 'failed';
  reason?: string;
  nextAllowedAt?: string;
}

export interface TriggerP0ReimportInput {
  freshness: P0Freshness;
  repoRoot: string;
  now?: () => Date;
  statePath?: string;
  runCommand?: (command: string, cwd: string) => void;
  settings?: P0ReimportSettings;
  auditLog?: { append: (event: { type: string; data: Record<string, unknown> }) => Promise<unknown> };
}

function defaultRunCommand(command: string, cwd: string): void {
  const child = spawn('bash', ['-lc', command], {
    cwd,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function resolveStatePath(repoRoot: string, relativePath?: string): string {
  const statePath = relativePath ?? process.env.HINDSIGHT_P0_REIMPORT_STATE_PATH ?? DEFAULT_REIMPORT_STATE_PATH;
  return resolve(repoRoot, statePath);
}

async function readState(repoRoot: string, relativePath?: string): Promise<P0ReimportState | null> {
  const path = resolveStatePath(repoRoot, relativePath);
  try {
    const raw = await readFile(path, 'utf8');
    return p0ReimportStateSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    return null;
  }
}

async function writeState(repoRoot: string, state: P0ReimportState, relativePath?: string): Promise<void> {
  const path = resolveStatePath(repoRoot, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function isTriggerCandidate(freshness: P0Freshness): boolean {
  return (
    freshness.status === 'stale' && (freshness.reason === 'commit_mismatch' || freshness.reason === 'watermark_missing')
  );
}

export function getDefaultP0FailClosedSettings(env: NodeJS.ProcessEnv = process.env): P0FailClosedSettings {
  const statuses = parseCsvEnumList(
    env.HINDSIGHT_P0_FAIL_CLOSED_STATUSES,
    ['fresh', 'stale', 'unknown'],
    ['stale'],
  ) as P0Freshness['status'][];

  return {
    enabled: parseBoolean(env.HINDSIGHT_P0_FAIL_CLOSED_ENABLED, true),
    statuses,
  };
}

export function getDefaultP0ReimportSettings(env: NodeJS.ProcessEnv = process.env): P0ReimportSettings {
  return {
    enabled: parseBoolean(env.HINDSIGHT_P0_AUTO_REIMPORT_ENABLED, true),
    cooldownMs: parseIntInRange(
      env.HINDSIGHT_P0_AUTO_REIMPORT_COOLDOWN_MS,
      DEFAULT_REIMPORT_COOLDOWN_MS,
      1000,
      86400000,
    ),
    command: env.HINDSIGHT_P0_AUTO_REIMPORT_COMMAND?.trim() || DEFAULT_REIMPORT_COMMAND,
  };
}

export function shouldFailClosedForFreshness(
  freshness: P0Freshness,
  settings: P0FailClosedSettings = getDefaultP0FailClosedSettings(),
): boolean {
  if (!settings.enabled) return false;
  return settings.statuses.includes(freshness.status);
}

export async function triggerP0ReimportIfNeeded(input: TriggerP0ReimportInput): Promise<P0ReimportTriggerResult> {
  const settings = input.settings ?? getDefaultP0ReimportSettings();
  if (!settings.enabled) return { status: 'disabled' };
  if (!isTriggerCandidate(input.freshness)) {
    return { status: 'skipped', reason: `freshness_${input.freshness.status}` };
  }

  const now = input.now?.() ?? new Date();
  const previous = await readState(input.repoRoot, input.statePath);
  const lastTriggeredMs = previous ? Date.parse(previous.lastTriggeredAt) : NaN;
  const nowMs = now.getTime();
  if (Number.isFinite(lastTriggeredMs) && nowMs - lastTriggeredMs < settings.cooldownMs) {
    const nextAllowedAt = new Date(lastTriggeredMs + settings.cooldownMs).toISOString();
    return {
      status: 'cooldown',
      reason: 'cooldown_active',
      nextAllowedAt,
    };
  }

  const runCommand = input.runCommand ?? defaultRunCommand;
  try {
    runCommand(settings.command, input.repoRoot);
    await writeState(
      input.repoRoot,
      {
        version: 1,
        lastTriggeredAt: now.toISOString(),
        lastFreshnessReason: input.freshness.reason ?? 'unknown',
      },
      input.statePath,
    );

    if (input.auditLog) {
      await input.auditLog.append({
        type: 'hindsight_freshness_reimport_triggered',
        data: {
          command: settings.command,
          cooldownMs: settings.cooldownMs,
          freshnessStatus: input.freshness.status,
          freshnessReason: input.freshness.reason ?? 'unknown',
        },
      });
    }

    return { status: 'triggered', reason: 'stale_detected' };
  } catch (err) {
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : 'trigger_failed',
    };
  }
}
