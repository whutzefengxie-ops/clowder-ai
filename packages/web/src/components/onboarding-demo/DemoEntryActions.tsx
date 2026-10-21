'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useShellCopy } from '../shell/shell-copy';
import { DEMO_SETTINGS_URL } from './demo-story';
import { onboardingEntryCopy } from './onboarding-entry.shell-copy';
import { beginOnboardingNavigation } from './onboarding-performance';

/** Independent of registry, identity admission and the first real conversation. */
export function DemoEntryActions({
  onShowCollaboration,
  empty = false,
}: {
  onShowCollaboration: () => void;
  empty?: boolean;
}) {
  const copy = useShellCopy(onboardingEntryCopy);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // The client registry cache can be populated before SSR's first roster read.
  const showEmpty = mounted && empty;
  return (
    <div className="mt-5">
      {showEmpty && <p className="mb-3 text-center text-sm text-cafe-secondary">{copy.empty}</p>}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => {
            beginOnboardingNavigation('demo-open');
            onShowCollaboration();
          }}
          data-testid="empty-state-bootcamp"
          className="shell-focusable rounded-xl border border-cafe-accent/20 bg-accent-50 px-4 py-2 text-sm font-medium text-cafe-accent"
        >
          {copy.watch}
        </button>
        <Link
          href={showEmpty ? DEMO_SETTINGS_URL : '/settings?s=members'}
          onClick={() => beginOnboardingNavigation('team-setup')}
          className="shell-focusable rounded-lg px-4 py-2 text-sm text-cafe-accent"
        >
          {showEmpty ? copy.create : copy.manage}
        </Link>
        {showEmpty && (
          <Link
            href="/settings?s=members&view=add&manual=1"
            className="shell-focusable rounded-lg px-4 py-2 text-sm text-cafe-secondary"
          >
            {copy.manual}
          </Link>
        )}
      </div>
    </div>
  );
}
