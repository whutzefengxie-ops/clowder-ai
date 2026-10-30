import { resolve } from 'node:path';
import type { SessionRecord } from '@cat-cafe/shared';
import type { FrozenExecutionBinding } from './execution-account-binding.js';

type Boundary = NonNullable<SessionRecord['hostExecutionBoundary']>;
type CurrentHostExecution = Readonly<{
  clientId?: string;
  implementation?: FrozenExecutionBinding['implementation'];
}>;

/** Safe selected Host facts only. Native state roots, instruction adoption and credential revisions are separate. */
export function captureHostExecutionBoundary(
  binding: FrozenExecutionBinding,
  carrier: string,
  current?: CurrentHostExecution,
): Boundary {
  const workspaceRoot = resolve(binding.workspace.workingDirectory ?? binding.projectRoot);
  const projectRoot = resolve(binding.workspace.workingProjectRoot ?? binding.projectRoot);
  return Object.freeze({
    v: 1,
    clientId: current?.clientId ?? binding.catConfig?.clientId ?? 'undeclared',
    carrier,
    implementationKey: current?.implementation?.key ?? binding.implementation?.key ?? 'undeclared',
    implementationGeneration: current?.implementation?.generation ?? binding.implementation?.generation ?? 'undeclared',
    accountRef: binding.resolvedAccount?.id ?? binding.effectiveAccountRef ?? null,
    workspaceRoot: process.platform === 'win32' ? workspaceRoot.toLowerCase() : workspaceRoot,
    projectRoot: process.platform === 'win32' ? projectRoot.toLowerCase() : projectRoot,
  });
}

/** Report changed dimensions rather than pretending that a single hash explains compatibility. */
export function changedHostExecutionBoundary(previous: Boundary | undefined, next: Boundary): string[] {
  if (!previous) return ['unknown'];
  return (Object.keys(next) as (keyof Boundary)[]).filter((key) => previous[key] !== next[key]);
}
