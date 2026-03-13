import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const { parseFetchSignalsArgs, formatFetchSignalsSummary, toFetchSignalsExitCode } = await import(
  '../dist/scripts/fetch-signals.js'
);

describe('fetch-signals script args', () => {
  it('parses --dry-run and --source flags', () => {
    const args = parseFetchSignalsArgs(['--dry-run', '--source', 'anthropic-news']);

    assert.equal(args.dryRun, true);
    assert.equal(args.sourceId, 'anthropic-news');
    assert.equal(args.help, false);
  });

  it('parses --help without requiring other flags', () => {
    const args = parseFetchSignalsArgs(['--help']);

    assert.equal(args.help, true);
    assert.equal(args.dryRun, false);
    assert.equal(args.sourceId, undefined);
  });

  it('throws on unknown flag', () => {
    assert.throws(() => parseFetchSignalsArgs(['--unknown']), /unknown argument: --unknown/);
  });

  it('throws when --source does not have value', () => {
    assert.throws(() => parseFetchSignalsArgs(['--source']), /--source requires a value/);
  });

  it('ignores bare -- separator from pnpm run forwarding', () => {
    const args = parseFetchSignalsArgs(['--', '--dry-run']);
    assert.equal(args.dryRun, true);
    assert.equal(args.help, false);
  });
});

describe('formatFetchSignalsSummary', () => {
  it('formats summary in one line for logs', () => {
    const line = formatFetchSignalsSummary({
      dryRun: true,
      fetchedAt: '2026-02-19T08:00:00.000Z',
      processedSources: 3,
      skippedSources: 2,
      fetchedArticles: 12,
      newArticles: 7,
      storedArticles: 0,
      duplicateArticles: 5,
      errors: [{ code: 'API_FETCH_FAILED', sourceId: 'x', message: 'timeout' }],
    });

    assert.match(line, /dryRun=true/);
    assert.match(line, /processed=3/);
    assert.match(line, /new=7/);
    assert.match(line, /errors=1/);
  });
});

describe('toFetchSignalsExitCode', () => {
  it('returns non-zero when scheduler summary contains source errors', () => {
    const code = toFetchSignalsExitCode({
      dryRun: false,
      fetchedAt: '2026-02-19T08:00:00.000Z',
      processedSources: 1,
      skippedSources: 0,
      fetchedArticles: 0,
      newArticles: 0,
      storedArticles: 0,
      duplicateArticles: 0,
      errors: [{ code: 'RSS_FETCH_FAILED', sourceId: 'anthropic-news', message: 'timeout' }],
    });

    assert.equal(code, 1);
  });

  it('returns non-zero when notifications contain error status', () => {
    const code = toFetchSignalsExitCode({
      dryRun: false,
      fetchedAt: '2026-02-19T08:00:00.000Z',
      processedSources: 1,
      skippedSources: 0,
      fetchedArticles: 2,
      newArticles: 2,
      storedArticles: 2,
      duplicateArticles: 0,
      errors: [],
      notifications: {
        email: { status: 'error', error: 'smtp auth failed' },
        inApp: { status: 'sent' },
      },
    });

    assert.equal(code, 1);
  });

  it('returns zero when scheduler summary has no errors', () => {
    const code = toFetchSignalsExitCode({
      dryRun: false,
      fetchedAt: '2026-02-19T08:00:00.000Z',
      processedSources: 1,
      skippedSources: 0,
      fetchedArticles: 2,
      newArticles: 2,
      storedArticles: 2,
      duplicateArticles: 0,
      errors: [],
    });

    assert.equal(code, 0);
  });
});
