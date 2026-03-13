/**
 * F051 v2 — HubQuotaBoardTab tests (glanceable quota board)
 *
 * Tests the rewritten quota board: flat pool list, one refresh button,
 * no ops UI. Each pool is a row with color dot + progress bar + percent.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { QuotaResponse } from './quota-test-fixtures';

// --- Fixtures ---

const MOCK_QUOTA_RESPONSE: QuotaResponse = {
  claude: {
    platform: 'claude',
    activeBlock: null,
    usageItems: [
      { label: 'Current session', usedPercent: 7, poolId: 'claude-session' },
      { label: 'Current week (all models)', usedPercent: 54, poolId: 'claude-weekly-all' },
      { label: 'Current week (Sonnet only)', usedPercent: 3, poolId: 'claude-weekly-sonnet' },
    ],
    recentBlocks: [],
    lastChecked: '2026-03-02T16:45:00Z',
  },
  codex: {
    platform: 'codex',
    usageItems: [
      { label: '5小时使用限额', usedPercent: 100, percentKind: 'remaining', poolId: 'codex-main' },
      { label: '每周使用限额', usedPercent: 80, percentKind: 'remaining', poolId: 'codex-main' },
      { label: 'GPT-5.3-Codex-Spark 5小时使用限额', usedPercent: 100, percentKind: 'remaining', poolId: 'codex-spark' },
      { label: 'GPT-5.3-Codex-Spark 每周使用限额', usedPercent: 93, percentKind: 'remaining', poolId: 'codex-spark' },
      { label: '代码审查', usedPercent: 44, percentKind: 'remaining', poolId: 'codex-review' },
    ],
    lastChecked: '2026-03-02T16:30:00Z',
  },
  gemini: {
    platform: 'gemini',
    usageItems: [
      { label: 'Gemini 2.5 Pro', usedPercent: 90, percentKind: 'remaining', poolId: 'gemini-pro' },
      { label: 'Gemini 2.5 Flash', usedPercent: 60, percentKind: 'remaining', poolId: 'gemini-flash' },
    ],
    lastChecked: '2026-03-02T16:40:00Z',
  },
  antigravity: {
    platform: 'antigravity',
    usageItems: [{ label: 'Codeium', usedPercent: 98, percentKind: 'remaining', poolId: 'codeium-main' }],
    lastChecked: '2026-03-02T16:42:00Z',
  },
  fetchedAt: '2026-03-02T16:45:00Z',
};

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// --- Mocks ---

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn((path: string) => {
    if (path === '/api/quota') return Promise.resolve(jsonResponse(MOCK_QUOTA_RESPONSE));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }),
}));

import { HubQuotaBoardTab } from '@/components/HubQuotaBoardTab';

describe('HubQuotaBoardTab v2 — glanceable quota board', () => {
  it('renders the 猫粮看板 title', () => {
    const html = renderToStaticMarkup(React.createElement(HubQuotaBoardTab));
    expect(html).toContain('猫粮看板');
  });

  it('renders 刷新全部 button (no confirm dialog)', () => {
    const html = renderToStaticMarkup(React.createElement(HubQuotaBoardTab));
    expect(html).toContain('刷新全部');
  });

  it('renders Claude section', () => {
    const html = renderToStaticMarkup(React.createElement(HubQuotaBoardTab));
    expect(html).toContain('布偶猫');
  });

  it('renders separated Codex pool groups when no data yet', () => {
    const html = renderToStaticMarkup(React.createElement(HubQuotaBoardTab));
    // Before data loads (SSR), shows OpenAI empty state
    expect(html).toContain('缅因猫');
  });

  it('renders Gemini and Antigravity sections', () => {
    const html = renderToStaticMarkup(React.createElement(HubQuotaBoardTab));
    expect(html).toContain('暹罗猫 Gemini');
    expect(html).toContain('Antigravity IDE');
  });

  it('does NOT contain old ops UI elements', () => {
    const html = renderToStaticMarkup(React.createElement(HubQuotaBoardTab));
    expect(html).not.toContain('Telemetry');
    expect(html).not.toContain('遥测');
    expect(html).not.toContain('状态总览');
    expect(html).not.toContain('操作建议');
    expect(html).not.toContain('止血模式');
    expect(html).not.toContain('探针');
    expect(html).not.toContain('CDP');
    expect(html).not.toContain('打开小组件视图');
  });
});

describe('HubQuotaBoardTab — polling & notification', () => {
  it('exports POLL_INTERVAL_MS for periodic refresh', async () => {
    const mod = await import('@/components/HubQuotaBoardTab');
    expect(mod.POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
    expect(mod.POLL_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });

  it('sends quota risk notification on first high-risk transition', async () => {
    const mod = await import('@/components/HubQuotaBoardTab');
    expect(
      mod.shouldSendQuotaRiskNotification({
        currentRisk: 'high',
        previousRisk: 'warn',
        lastAlertAt: 0,
        nowMs: 1_000,
      }),
    ).toBe(true);
  });

  it('dedupes repeated high-risk notifications within time window', async () => {
    const mod = await import('@/components/HubQuotaBoardTab');
    expect(
      mod.shouldSendQuotaRiskNotification({
        currentRisk: 'high',
        previousRisk: 'high',
        lastAlertAt: 1_000,
        nowMs: 1_000 + mod.QUOTA_ALERT_DEDUPE_WINDOW_MS - 1,
      }),
    ).toBe(false);
    expect(
      mod.shouldSendQuotaRiskNotification({
        currentRisk: 'high',
        previousRisk: 'high',
        lastAlertAt: 1_000,
        nowMs: 1_000 + mod.QUOTA_ALERT_DEDUPE_WINDOW_MS + 1,
      }),
    ).toBe(true);
  });
});

describe('quota-cards — pool grouping and row rendering', () => {
  it('groups codex items by poolId', async () => {
    const { groupCodexByPool } = await import('@/components/quota-cards');
    const pools = groupCodexByPool(MOCK_QUOTA_RESPONSE.codex.usageItems);
    expect(pools).toHaveLength(3);
    expect(pools[0].poolId).toBe('codex-main');
    expect(pools[0].displayName).toContain('Codex');
    expect(pools[0].items).toHaveLength(2);
    expect(pools[1].poolId).toBe('codex-spark');
    expect(pools[1].displayName).toContain('Spark');
    expect(pools[1].items).toHaveLength(2);
    expect(pools[2].poolId).toBe('codex-review');
    expect(pools[2].displayName).toContain('代码审查');
    expect(pools[2].items).toHaveLength(1);
  });

  it('renders remaining percent directly in QuotaPoolRow', async () => {
    const { QuotaPoolRow } = await import('@/components/quota-cards');
    const html = renderToStaticMarkup(
      React.createElement(QuotaPoolRow, {
        item: { label: '每周使用限额', usedPercent: 97, percentKind: 'remaining', poolId: 'codex-main' },
      }),
    );
    expect(html).toContain('97%');
    expect(html).toContain('剩余');
  });

  it('progress bar uses green for healthy remaining (97%), red for low remaining (10%)', async () => {
    const { QuotaPoolRow } = await import('@/components/quota-cards');
    // 97% remaining = 3% used = healthy → should be green
    const healthyHtml = renderToStaticMarkup(
      React.createElement(QuotaPoolRow, {
        item: { label: 'test', usedPercent: 97, percentKind: 'remaining' },
      }),
    );
    expect(healthyHtml).toContain('bg-emerald-500');
    expect(healthyHtml).not.toContain('bg-rose-500');

    // 10% remaining = 90% used = danger → should be red
    const dangerHtml = renderToStaticMarkup(
      React.createElement(QuotaPoolRow, {
        item: { label: 'test', usedPercent: 10, percentKind: 'remaining' },
      }),
    );
    expect(dangerHtml).toContain('bg-rose-500');
    expect(dangerHtml).not.toContain('bg-emerald-500');
  });

  it('renders resetsAt as formatted time when resetsText is absent', async () => {
    const { QuotaPoolRow } = await import('@/components/quota-cards');
    const html = renderToStaticMarkup(
      React.createElement(QuotaPoolRow, {
        item: { label: 'Gemini Pro', usedPercent: 10, percentKind: 'used', resetsAt: '2026-03-05T19:00:00Z' },
      }),
    );
    // Should show some formatted reset time (not empty)
    expect(html).toMatch(/resets|重置|Mar|3月|19:00/i);
  });

  it('shows degradation hint when utilization >= 80%', async () => {
    const { degradationHint } = await import('@/components/quota-cards');
    expect(degradationHint('codex-review', 80)).toContain('@gpt52');
    expect(degradationHint('codex-main', 85)).toContain('@spark');
    expect(degradationHint('claude-session', 90)).toContain('Sonnet');
    expect(degradationHint('codex-main', 50)).toBeNull();
  });

  it('computes utilization correctly for remaining vs used', async () => {
    const { toUtilization } = await import('@/components/quota-cards');
    expect(toUtilization({ label: 'x', usedPercent: 80, percentKind: 'remaining' })).toBe(20);
    expect(toUtilization({ label: 'x', usedPercent: 54 })).toBe(54);
  });
});
