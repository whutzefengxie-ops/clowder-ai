export interface AcpPoolSpawnSignatureInput {
  command: string;
  args: string[];
  cwd: string;
  bootstrapIsolation?: string;
  env?: Record<string, string> | null;
  openCodeRuntimeConfig?: unknown;
  contextPolicy?: unknown;
  maxLiveProcesses: number;
  idleTtlMs: number;
  transport?: 'stdio' | 'httpstream';
  supportsMultiplexing?: boolean;
  protocolAdapter?: string;
  /**
   * C09/O1: client permission default. A member policy edit must produce a new
   * pool generation so an explicit auto_allow revocation cannot keep a warm
   * client whose closure still allows. Absent => fail closed.
   */
  permissionDecision?: 'allow' | 'reject';
  sessionPolicy?: unknown;
}

export function createAcpPoolSpawnSignature(input: AcpPoolSpawnSignatureInput): string {
  return JSON.stringify({
    cmd: input.command,
    args: input.args,
    cwd: input.cwd,
    bootstrapIsolation: input.bootstrapIsolation ?? null,
    env: input.env ?? null,
    openCodeRuntimeConfig: input.openCodeRuntimeConfig ?? null,
    contextPolicy: input.contextPolicy ?? null,
    maxLiveProcesses: input.maxLiveProcesses,
    idleTtlMs: input.idleTtlMs,
    transport: input.transport ?? 'stdio',
    supportsMultiplexing: input.supportsMultiplexing === true,
    protocolAdapter: input.protocolAdapter ?? null,
    permissionDecision: input.permissionDecision ?? 'reject',
    ...(input.sessionPolicy ? { sessionPolicy: input.sessionPolicy } : {}),
  });
}
