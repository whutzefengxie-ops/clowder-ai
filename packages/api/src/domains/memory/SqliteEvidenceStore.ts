// F102: SQLite implementation of IEvidenceStore

import Database from 'better-sqlite3';
import type { Edge, EvidenceItem, IEvidenceStore, SearchOptions } from './interfaces.js';
import { CURRENT_SCHEMA_VERSION, FTS_TRIGGER_STATEMENTS, SCHEMA_V1 } from './schema.js';

export class SqliteEvidenceStore implements IEvidenceStore {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(SCHEMA_V1);
    for (const stmt of FTS_TRIGGER_STATEMENTS) {
      this.db.exec(stmt);
    }

    // Record schema version
    const existing = this.db.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').get() as
      | { version: number }
      | undefined;
    if (!existing) {
      this.db
        .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
        .run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
    }
  }

  async search(query: string, options?: SearchOptions): Promise<EvidenceItem[]> {
    this.ensureOpen();
    const limit = options?.limit ?? 10;
    const trimmed = query.trim();
    if (!trimmed) return [];

    // ── Exact-anchor bypass ──────────────────────────────────────────
    // FTS5 unicode61 tokenizer splits "F042" → "F"+"042" and "ADR-005" → "ADR"+"005".
    // For anchor-shaped queries, do a direct lookup so precision isn't lost.
    const results: EvidenceItem[] = [];
    const seenAnchors = new Set<string>();

    let anchorSql = 'SELECT * FROM evidence_docs WHERE anchor = ? COLLATE NOCASE';
    const anchorParams: unknown[] = [trimmed];
    if (options?.kind) {
      anchorSql += ' AND kind = ?';
      anchorParams.push(options.kind);
    }
    if (options?.status) {
      anchorSql += ' AND status = ?';
      anchorParams.push(options.status);
    }
    if (options?.keywords?.length) {
      anchorSql += ` AND (${options.keywords.map(() => 'keywords LIKE ?').join(' OR ')})`;
      anchorParams.push(...options.keywords.map((kw) => `%"${kw}"%`));
    }
    const exactRow = this.db?.prepare(anchorSql).get(...anchorParams) as RowShape | undefined;
    if (exactRow) {
      results.push(rowToItem(exactRow));
      seenAnchors.add(exactRow.anchor);
    }

    // ── FTS5 full-text search ────────────────────────────────────────
    const ftsQuery = trimmed
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, '""')}"`)
      .join(' ');

    if (ftsQuery) {
      try {
        let sql = `
				SELECT d.*, bm25(evidence_fts, 5.0, 1.0) AS rank
				FROM evidence_fts f
				JOIN evidence_docs d ON d.rowid = f.rowid
				WHERE evidence_fts MATCH ?
			`;
        const params: unknown[] = [ftsQuery];

        if (options?.kind) {
          sql += ' AND d.kind = ?';
          params.push(options.kind);
        }
        if (options?.status) {
          sql += ' AND d.status = ?';
          params.push(options.status);
        }
        if (options?.keywords?.length) {
          sql += ` AND (${options.keywords.map(() => 'd.keywords LIKE ?').join(' OR ')})`;
          params.push(...options.keywords.map((kw) => `%"${kw}"%`));
        }

        // Superseded items sort last (KD-16)
        sql += ' ORDER BY (d.superseded_by IS NOT NULL), rank';
        sql += ' LIMIT ?';
        params.push(limit);

        const rows = this.db?.prepare(sql).all(...params) as RowShape[];
        for (const row of rows) {
          if (!seenAnchors.has(row.anchor)) {
            results.push(rowToItem(row));
            seenAnchors.add(row.anchor);
          }
        }
      } catch {
        // FTS5 syntax error (malformed query) — degrade to anchor-only results
      }
    }

    return results.slice(0, limit);
  }

  async upsert(items: EvidenceItem[]): Promise<void> {
    this.ensureOpen();
    const stmt = this.db?.prepare(`
			INSERT OR REPLACE INTO evidence_docs
			(anchor, kind, status, title, summary, keywords, source_path, source_hash,
			 superseded_by, materialized_from, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

    const tx = this.db?.transaction((items: EvidenceItem[]) => {
      for (const item of items) {
        stmt.run(
          item.anchor,
          item.kind,
          item.status,
          item.title,
          item.summary ?? null,
          item.keywords ? JSON.stringify(item.keywords) : null,
          item.sourcePath ?? null,
          item.sourceHash ?? null,
          item.supersededBy ?? null,
          item.materializedFrom ?? null,
          item.updatedAt,
        );
      }
    });
    tx(items);
  }

  async deleteByAnchor(anchor: string): Promise<void> {
    this.ensureOpen();
    this.db?.prepare('DELETE FROM evidence_docs WHERE anchor = ?').run(anchor);
  }

  async getByAnchor(anchor: string): Promise<EvidenceItem | null> {
    this.ensureOpen();
    const row = this.db?.prepare('SELECT * FROM evidence_docs WHERE anchor = ? COLLATE NOCASE').get(anchor) as
      | RowShape
      | undefined;
    return row ? rowToItem(row) : null;
  }

  async health(): Promise<boolean> {
    try {
      if (!this.db || !this.db.open) return false;
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /** Expose db for IndexBuilder and other internal consumers */
  getDb(): Database.Database {
    this.ensureOpen();
    return this.db!;
  }

  // ── Edge operations ─────────────────────────────────────────────────

  async addEdge(edge: Edge): Promise<void> {
    this.ensureOpen();
    this.db
      ?.prepare('INSERT OR IGNORE INTO edges (from_anchor, to_anchor, relation) VALUES (?, ?, ?)')
      .run(edge.fromAnchor, edge.toAnchor, edge.relation);
  }

  async getRelated(anchor: string): Promise<Array<{ anchor: string; relation: string }>> {
    this.ensureOpen();
    const rows = this.db
      ?.prepare(
        `SELECT to_anchor AS anchor, relation FROM edges WHERE from_anchor = ?
			 UNION
			 SELECT from_anchor AS anchor, relation FROM edges WHERE to_anchor = ?`,
      )
      .all(anchor, anchor) as Array<{ anchor: string; relation: string }>;
    return rows;
  }

  async removeEdge(edge: Edge): Promise<void> {
    this.ensureOpen();
    this.db
      ?.prepare('DELETE FROM edges WHERE from_anchor = ? AND to_anchor = ? AND relation = ?')
      .run(edge.fromAnchor, edge.toAnchor, edge.relation);
  }

  close(): void {
    if (this.db?.open) {
      this.db.close();
    }
    this.db = null;
  }

  private ensureOpen(): void {
    if (!this.db || !this.db.open) {
      throw new Error('SqliteEvidenceStore not initialized — call initialize() first');
    }
  }
}

// ── Row mapping ──────────────────────────────────────────────────────

interface RowShape {
  anchor: string;
  kind: string;
  status: string;
  title: string;
  summary: string | null;
  keywords: string | null;
  source_path: string | null;
  source_hash: string | null;
  superseded_by: string | null;
  materialized_from: string | null;
  updated_at: string;
}

function rowToItem(row: RowShape): EvidenceItem {
  const item: EvidenceItem = {
    anchor: row.anchor,
    kind: row.kind as EvidenceItem['kind'],
    status: row.status as EvidenceItem['status'],
    title: row.title,
    updatedAt: row.updated_at,
  };
  if (row.summary != null) item.summary = row.summary;
  if (row.keywords != null) item.keywords = JSON.parse(row.keywords);
  if (row.source_path != null) item.sourcePath = row.source_path;
  if (row.source_hash != null) item.sourceHash = row.source_hash;
  if (row.superseded_by != null) item.supersededBy = row.superseded_by;
  if (row.materialized_from != null) item.materializedFrom = row.materialized_from;
  return item;
}
