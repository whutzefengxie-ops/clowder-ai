import { CODEX_LIVE_DISABLED_FEATURES } from './codex-live-policy.js';

/** Text inference keeps member attribution without compiling private household/project context. */
export function feedbackDiagnosticIdentity(catId: string): string {
  return `You are the configured Clowder AI member ${catId}. This invocation only analyzes owner-approved sanitized feedback material. Follow the diagnostic recipe. Do not access tools, files, private memory or business sessions.`;
}
export const FEEDBACK_CODEX_ARGS = [
  '--ephemeral',
  '--ignore-rules',
  '--strict-config',
  '--config',
  'project_doc_max_bytes=0',
  '--config',
  'skills.include_instructions=false',
  '--config',
  'orchestrator.skills.enabled=false',
  '--config',
  'orchestrator.mcp.enabled=false',
  '--config',
  'web_search="disabled"',
  ...[...CODEX_LIVE_DISABLED_FEATURES, 'multi_agent', 'hooks', 'js_repl'].flatMap((feature) => [
    '--config',
    `features.${feature}=false`,
  ]),
];
