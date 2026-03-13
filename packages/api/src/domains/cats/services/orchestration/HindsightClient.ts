/**
 * Hindsight HTTP Client
 * Server-side only. Wraps Hindsight Retain/Recall/Reflect API.
 *
 * ADR-005: Single bank (cat-cafe-shared), tags/metadata filtering.
 * Phase 5.0: Memory Operation Profiles.
 */

/** A single memory item returned from Hindsight Recall */
export interface HindsightMemory {
  content: string;
  document_id?: string;
  tags?: string[];
  metadata?: Record<string, string>;
  score?: number;
}

/** Options for Recall requests */
export interface RecallOptions {
  limit?: number;
  budget?: 'low' | 'mid' | 'high';
  types?: Array<'world' | 'experience' | 'observation'>;
  tags?: string[];
  tagsMatch?: 'all_strict' | 'any_strict' | 'all' | 'any';
}

/** A single item to retain */
export interface RetainItem {
  content: string;
  document_id?: string;
  timestamp?: number;
  tags?: string[];
  metadata?: Record<string, string>;
}

/** Options for Retain requests */
export interface RetainOptions {
  async?: boolean;
  document_tags?: string[];
}

/** Structured error from Hindsight calls */
export class HindsightError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'HindsightError';
  }
}

/** Interface for testability / DI */
export interface IHindsightClient {
  recall(bankId: string, query: string, options?: RecallOptions): Promise<HindsightMemory[]>;
  retain(bankId: string, items: RetainItem[], options?: RetainOptions): Promise<void>;
  reflect(bankId: string, query: string): Promise<string>;
  ensureBank(bankId: string, name?: string, background?: string): Promise<void>;
  isHealthy(): Promise<boolean>;
}

/**
 * HTTP client for Hindsight long-term memory service.
 * Only called from server-side (never from browser).
 */
export class HindsightClient implements IHindsightClient {
  private static readonly REQUEST_TIMEOUT_MS = 8000;

  constructor(private readonly baseUrl: string) {}

  /** Retrieve memories matching a query */
  async recall(bankId: string, query: string, options?: RecallOptions): Promise<HindsightMemory[]> {
    const body: Record<string, unknown> = { query };
    if (options?.limit != null) body.limit = options.limit;
    if (options?.budget) body.budget = options.budget;
    if (options?.types) body.types = options.types;
    if (options?.tags) body.tags = options.tags;
    if (options?.tagsMatch) body.tags_match = options.tagsMatch;

    const res = await this.post(`/v1/default/banks/${bankId}/memories/recall`, body);
    return (res.memories as HindsightMemory[]) ?? [];
  }

  /** Store memory items into a bank */
  async retain(bankId: string, items: RetainItem[], options?: RetainOptions): Promise<void> {
    const body: Record<string, unknown> = { items };
    if (options?.async != null) body.async = options.async;
    if (options?.document_tags) body.document_tags = options.document_tags;

    await this.post(`/v1/default/banks/${bankId}/memories`, body);
  }

  /** LLM-based reflection on stored memories */
  async reflect(bankId: string, query: string): Promise<string> {
    const res = await this.post(`/v1/default/banks/${bankId}/reflect`, { query });
    return (res.reflection as string) ?? '';
  }

  /** Ensure a bank exists; create if missing (idempotent PUT) */
  async ensureBank(bankId: string, name?: string, background?: string): Promise<void> {
    const body: Record<string, unknown> = {
      name: name ?? bankId,
    };
    if (background) body.background = background;

    const url = `${this.baseUrl}/v1/default/banks/${bankId}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HindsightClient.REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const lower = msg.toLowerCase();
      const code = lower.includes('timeout') || lower.includes('aborted') ? 'TIMEOUT' : 'CONNECTION_FAILED';
      throw new HindsightError(code, `Cannot reach Hindsight at ${this.baseUrl}: ${msg}`);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HindsightError(
        'BANK_CREATE_FAILED',
        `Failed to ensure bank ${bankId}: ${res.status} ${text}`,
        res.status,
      );
    }
  }

  /** Quick health check */
  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Internal POST helper with structured error handling */
  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HindsightClient.REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      const lower = msg.toLowerCase();
      const code = lower.includes('timeout') || lower.includes('aborted') ? 'TIMEOUT' : 'CONNECTION_FAILED';
      throw new HindsightError(code, `Cannot reach Hindsight at ${this.baseUrl}: ${msg}`);
    }

    if (!res.ok) {
      const text = await this.readBodyAsText(res);
      throw new HindsightError('API_ERROR', `Hindsight ${path} returned ${res.status}: ${text}`, res.status);
    }

    if (res.status === 204) return {};

    const text = await this.readBodyAsText(res);
    if (!text.trim()) return {};

    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (typeof (res as { json?: () => Promise<unknown> }).json === 'function') {
        return (await (res as { json: () => Promise<Record<string, unknown>> }).json()) ?? {};
      }
      throw new HindsightError('INVALID_RESPONSE', `Hindsight ${path} returned non-JSON response`, res.status);
    }
  }

  private async readBodyAsText(res: Response): Promise<string> {
    if (typeof (res as { text?: () => Promise<string> }).text === 'function') {
      return (await (res as { text: () => Promise<string> }).text().catch(() => '')) ?? '';
    }

    if (typeof (res as { json?: () => Promise<unknown> }).json === 'function') {
      try {
        const value = await (res as { json: () => Promise<unknown> }).json();
        if (typeof value === 'string') return value;
        return JSON.stringify(value ?? '');
      } catch {
        return '';
      }
    }

    return '';
  }
}

/** Factory function matching codebase convention */
export function createHindsightClient(url?: string): HindsightClient {
  return new HindsightClient(url ?? process.env.HINDSIGHT_URL ?? 'http://localhost:18888');
}
