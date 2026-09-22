export type OnboardingAuthStatus = 'ready' | 'login_required' | 'pending';

export interface OnboardingClient {
  client: string;
  label: string;
  installed: boolean;
  authStatus: OnboardingAuthStatus;
  provider?: string;
}

export interface OnboardingRealMember {
  client: string;
  label: string;
  isReal: true;
  provider?: string;
}

export interface OnboardingTemplateDraft {
  id: string;
  name: string;
  nickname?: string;
  avatar: string;
  color: { primary: string; secondary: string };
  roleDescription: string;
  personality: string;
  teamStrengths?: string;
}

export interface OnboardingClientDraft {
  client: string;
  provider: string;
  label: string;
  cli: string;
  installed: boolean;
  version?: string;
  hasApiKey: boolean;
  authStatus: OnboardingAuthStatus;
}

export interface OnboardingConfigDraft {
  accountRef: string;
  model: string;
}

export interface OnboardingSetupDraft {
  template?: OnboardingTemplateDraft;
  clients: OnboardingClientDraft[];
  configs: Record<string, OnboardingConfigDraft>;
  configIndex: number;
}

export type OnboardingStage = 'demo' | 'handoff' | 'setup' | 'ready' | 'complete';
export type DemoScene = 'opening' | 'draft' | 'review' | 'improved' | 'handoff';

export interface OnboardingJourneyState {
  version: 1;
  stage: OnboardingStage;
  demoParticipants: readonly string[];
  demoScene: DemoScene;
  demoPaused: boolean;
  demoCompletedAt?: number;
  realMembers: OnboardingRealMember[];
  setup?: OnboardingSetupDraft;
  threadId?: string;
  completedAt?: number;
}

const DEMO_PARTICIPANTS = ['规划猫', '实现猫', '审查猫'] as const;

export function createJourneyState(): OnboardingJourneyState {
  return {
    version: 1,
    stage: 'demo',
    demoParticipants: [...DEMO_PARTICIPANTS],
    demoScene: 'opening',
    demoPaused: false,
    realMembers: [],
  };
}

export function canContinueClientSetup(clients: readonly OnboardingClient[]): boolean {
  return clients.length > 0 && clients.every((client) => client.installed && client.authStatus === 'ready');
}

export function mergeDetectedAuthStatus(
  derived: OnboardingAuthStatus,
  saved?: OnboardingAuthStatus,
): OnboardingAuthStatus {
  if (derived === 'ready') return 'ready';
  if (saved === 'pending') return 'pending';
  return derived;
}

export function buildRealMembers(clients: readonly OnboardingClient[]): OnboardingRealMember[] {
  const seen = new Set<string>();
  return clients
    .filter((client) => client.installed && client.authStatus === 'ready')
    .filter((client) => {
      if (seen.has(client.client)) return false;
      seen.add(client.client);
      return true;
    })
    .map((client) => ({
      client: client.client,
      label: client.label,
      isReal: true as const,
      ...(client.provider ? { provider: client.provider } : {}),
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStage(value: unknown): value is OnboardingStage {
  return value === 'demo' || value === 'handoff' || value === 'setup' || value === 'ready' || value === 'complete';
}

function isDemoScene(value: unknown): value is DemoScene {
  return value === 'opening' || value === 'draft' || value === 'review' || value === 'improved' || value === 'handoff';
}

function isRealMember(value: unknown): value is OnboardingRealMember {
  return (
    isRecord(value) &&
    typeof value.client === 'string' &&
    typeof value.label === 'string' &&
    value.isReal === true &&
    (value.provider === undefined || typeof value.provider === 'string')
  );
}

function isTemplateDraft(value: unknown): value is OnboardingTemplateDraft {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.nickname === undefined || typeof value.nickname === 'string') &&
    typeof value.avatar === 'string' &&
    isRecord(value.color) &&
    typeof value.color.primary === 'string' &&
    typeof value.color.secondary === 'string' &&
    typeof value.roleDescription === 'string' &&
    typeof value.personality === 'string' &&
    (value.teamStrengths === undefined || typeof value.teamStrengths === 'string')
  );
}

function isClientDraft(value: unknown): value is OnboardingClientDraft {
  return (
    isRecord(value) &&
    typeof value.client === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.label === 'string' &&
    typeof value.cli === 'string' &&
    typeof value.installed === 'boolean' &&
    (value.version === undefined || typeof value.version === 'string') &&
    typeof value.hasApiKey === 'boolean' &&
    (value.authStatus === 'ready' || value.authStatus === 'login_required' || value.authStatus === 'pending')
  );
}

function isConfigDraft(value: unknown): value is OnboardingConfigDraft {
  return isRecord(value) && typeof value.accountRef === 'string' && typeof value.model === 'string';
}

function isSetupDraft(value: unknown): value is OnboardingSetupDraft {
  if (!isRecord(value) || !Array.isArray(value.clients) || !value.clients.every(isClientDraft)) return false;
  if (!isRecord(value.configs) || !Object.values(value.configs).every(isConfigDraft)) return false;
  return (
    (value.template === undefined || isTemplateDraft(value.template)) &&
    typeof value.configIndex === 'number' &&
    Number.isInteger(value.configIndex) &&
    value.configIndex >= 0 &&
    value.configIndex <= value.clients.length
  );
}

export function restoreJourneyState(serialized: string | null | undefined): OnboardingJourneyState | null {
  if (!serialized) return null;
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed) || parsed.version !== 1 || !isStage(parsed.stage)) return null;
    if (!Array.isArray(parsed.demoParticipants) || !parsed.demoParticipants.every((item) => typeof item === 'string')) {
      return null;
    }
    if (!isDemoScene(parsed.demoScene) || typeof parsed.demoPaused !== 'boolean') return null;
    if (!Array.isArray(parsed.realMembers) || !parsed.realMembers.every(isRealMember)) return null;
    if (parsed.demoCompletedAt !== undefined && typeof parsed.demoCompletedAt !== 'number') return null;
    if (parsed.setup !== undefined && !isSetupDraft(parsed.setup)) return null;
    if (parsed.threadId !== undefined && typeof parsed.threadId !== 'string') return null;
    if (parsed.completedAt !== undefined && typeof parsed.completedAt !== 'number') return null;
    return {
      version: 1,
      stage: parsed.stage,
      demoParticipants: [...parsed.demoParticipants],
      demoScene: parsed.demoScene,
      demoPaused: parsed.demoPaused,
      ...(parsed.demoCompletedAt === undefined ? {} : { demoCompletedAt: parsed.demoCompletedAt }),
      realMembers: parsed.realMembers.map((member) => ({ ...member })),
      ...(parsed.setup === undefined
        ? {}
        : {
            setup: {
              ...(parsed.setup.template === undefined ? {} : { template: { ...parsed.setup.template, color: { ...parsed.setup.template.color } } }),
              clients: parsed.setup.clients.map((client) => ({ ...client })),
              configs: Object.fromEntries(Object.entries(parsed.setup.configs).map(([key, config]) => [key, { ...config }])),
              configIndex: parsed.setup.configIndex,
            },
          }),
      ...(parsed.threadId === undefined ? {} : { threadId: parsed.threadId }),
      ...(parsed.completedAt === undefined ? {} : { completedAt: parsed.completedAt }),
    };
  } catch {
    return null;
  }
}

export function markFirstRealMessage(state: OnboardingJourneyState, timestamp = Date.now()): OnboardingJourneyState {
  if (state.stage !== 'ready' || state.completedAt !== undefined) return state;
  return { ...state, stage: 'complete', completedAt: timestamp };
}
