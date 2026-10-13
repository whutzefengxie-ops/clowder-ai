'use client';
import { useShellCopy } from '../shell/shell-copy';
import { DEMO_SETTINGS_URL } from './demo-story';
import { onboardingEntryCopy } from './onboarding-entry.shell-copy';

/** Independent of registry, identity admission and the first real conversation. */
export function DemoEntryActions({ onShowCollaboration }: { onShowCollaboration: () => void }) {
  const copy = useShellCopy(onboardingEntryCopy);
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
      <button
        type="button"
        onClick={onShowCollaboration}
        data-testid="empty-state-bootcamp"
        className="shell-focusable rounded-xl border border-cafe-accent/20 bg-accent-50 px-4 py-2 text-sm font-medium text-cafe-accent"
      >
        {copy.watch}
      </button>
      <a href={DEMO_SETTINGS_URL} className="shell-focusable rounded-lg px-4 py-2 text-sm text-cafe-accent">
        {copy.create}
      </a>
    </div>
  );
}
