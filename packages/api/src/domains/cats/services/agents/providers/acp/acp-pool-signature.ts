export interface AcpPoolSpawnSignatureInput {
  command: string;
  args: string[];
  cwd: string;
  bootstrapIsolation?: string;
  /** Policy identifier for startup policy matching (W3: enables pool invalidation on policy revocation) */
  policyId?: string;
  /** Policy revision number (W3: enables pool invalidation on policy updates) */
  policyRevision?: number;
  env?: Record<string, string> | null;
  openCodeRuntimeConfig?: unknown;
  contextPolicy?: unknown;
  maxLiveProcesses: number;
  idleTtlMs: number;
  transport?: 'stdio' | 'httpstream';
  supportsMultiplexing?: boolean;
  sessionPolicy?: unknown;
}

export function createAcpPoolSpawnSignature(input: AcpPoolSpawnSignatureInput): string {
  return JSON.stringify({
    cmd: input.command,
    args: input.args,
    cwd: input.cwd,
    bootstrapIsolation: input.bootstrapIsolation ?? null,
    policyId: input.policyId ?? null,
    policyRevision: input.policyRevision ?? null,
    env: input.env ?? null,
    openCodeRuntimeConfig: input.openCodeRuntimeConfig ?? null,
    contextPolicy: input.contextPolicy ?? null,
    maxLiveProcesses: input.maxLiveProcesses,
    idleTtlMs: input.idleTtlMs,
    transport: input.transport ?? 'stdio',
    supportsMultiplexing: input.supportsMultiplexing === true,
    ...(input.sessionPolicy ? { sessionPolicy: input.sessionPolicy } : {}),
  });
}
