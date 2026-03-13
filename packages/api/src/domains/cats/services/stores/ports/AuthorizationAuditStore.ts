/**
 * Authorization Audit Store
 * 审计日志持久化 — 所有授权事件必须有记录
 */

import type { AuthorizationAuditEntry, CatId, RespondScope } from '@cat-cafe/shared';
import { generateSortableId } from './MessageStore.js';

export interface CreateAuditInput {
  readonly requestId: string;
  readonly invocationId: string;
  readonly catId: CatId;
  readonly threadId: string;
  readonly action: string;
  readonly reason: string;
  readonly decision: 'allow' | 'deny' | 'pending';
  readonly scope?: RespondScope;
  readonly decidedBy?: string;
  readonly matchedRuleId?: string;
}

export interface IAuthorizationAuditStore {
  append(input: CreateAuditInput): AuthorizationAuditEntry | Promise<AuthorizationAuditEntry>;
  list(filter?: {
    catId?: CatId;
    threadId?: string;
    limit?: number;
  }): AuthorizationAuditEntry[] | Promise<AuthorizationAuditEntry[]>;
}

const DEFAULT_MAX = 5000;

export class AuthorizationAuditStore implements IAuthorizationAuditStore {
  private entries: AuthorizationAuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(options?: { maxEntries?: number }) {
    this.maxEntries = options?.maxEntries ?? DEFAULT_MAX;
  }

  append(input: CreateAuditInput): AuthorizationAuditEntry {
    if (this.entries.length >= this.maxEntries) {
      this.entries = this.entries.slice(-Math.floor(this.maxEntries * 0.8));
    }

    const entry: AuthorizationAuditEntry = {
      ...input,
      id: generateSortableId(Date.now()),
      createdAt: Date.now(),
      ...(input.decidedBy ? { decidedAt: Date.now() } : {}),
    };
    this.entries.push(entry);
    return entry;
  }

  list(filter?: { catId?: CatId; threadId?: string; limit?: number }): AuthorizationAuditEntry[] {
    const limit = filter?.limit ?? 100;
    const result: AuthorizationAuditEntry[] = [];

    for (let i = this.entries.length - 1; i >= 0 && result.length < limit; i--) {
      const entry = this.entries[i]!;
      if (filter?.catId && entry.catId !== filter.catId) continue;
      if (filter?.threadId && entry.threadId !== filter.threadId) continue;
      result.push(entry);
    }
    return result;
  }

  get size(): number {
    return this.entries.length;
  }
}
