/** W4.P only: caller-owned native fence, plugged into the fixed upstream bridge. */
export interface TextPrompt {
  type: 'text';
  text: string;
}
export interface NativeCodexBridge {
  steerTurn(params: { threadId: string; turnId: string; prompt: TextPrompt[] }): Promise<{ turnId: string }>;
}
interface Snapshot {
  sessionId: string;
  currentTurnId: string | null;
}
export class CodexNativeFence {
  private readonly operations = new Map<string, { signature: string; receipt: Promise<Record<string, unknown>> }>();
  constructor(
    private readonly snapshot: (sessionId: string) => Snapshot,
    private readonly bridge: NativeCodexBridge,
  ) {}
  async handle(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof params.sessionId !== 'string' || !params.sessionId) throw new Error('invalid_session');
    const state = this.snapshot(params.sessionId);
    if (params.action === 'snapshot')
      return {
        nativeSessionId: state.sessionId,
        nativeTurnId: state.currentTurnId,
        source: 'native_turn_start_callback',
      };
    if (
      params.action !== 'steer' ||
      params.nativeSessionId !== state.sessionId ||
      typeof params.expectedTurnId !== 'string' ||
      !params.expectedTurnId ||
      typeof params.operationId !== 'string' ||
      !params.operationId
    )
      throw new Error('invalid_native_target');
    const prompt = params.prompt;
    if (
      !Array.isArray(prompt) ||
      !prompt.length ||
      !prompt.every((item) => item && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    )
      throw new Error('invalid_prompt');
    const key = JSON.stringify([state.sessionId, params.operationId]);
    const nativeSessionId = state.sessionId;
    const expectedTurnId = params.expectedTurnId;
    const operationId = params.operationId;
    const signature = JSON.stringify([params.nativeSessionId, params.expectedTurnId, prompt]);
    const prior = this.operations.get(key);
    if (prior) {
      if (prior.signature !== signature) throw new Error('operation_conflict');
      return prior.receipt;
    }
    // Never replace the caller target with the current turn, even after an await.
    const receipt = this.bridge
      .steerTurn({ threadId: nativeSessionId, turnId: expectedTurnId, prompt: prompt as TextPrompt[] })
      .then((native) => {
        if (native.turnId !== expectedTurnId) throw new Error('native_receipt_target_mismatch');
        return {
          operationId,
          nativeSessionId,
          nativeTurnId: native.turnId,
          outcome: 'injected',
          nativeReceipt: native,
        };
      });
    this.operations.set(key, { signature, receipt });
    return receipt;
  }
}
