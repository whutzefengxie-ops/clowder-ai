'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { MemberSettingsPage } from './MemberSettingsPage';
import { RecommendedTeamSetup } from './RecommendedTeamSetup';

/** Keep first-run selection stable while a partially created roster refreshes. */
export function MemberCreationPage({
  onTeamCreated,
  ...props
}: Omit<Parameters<typeof MemberSettingsPage>[0], 'cat'> & { onTeamCreated: () => Promise<void> }) {
  const params = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<'team' | 'manual'>(
    params.get('manual') === '1' || params.get('view') !== 'setup' ? 'manual' : 'team',
  );
  if (mode === 'manual') return <MemberSettingsPage {...props} cat={null} />;
  return (
    <RecommendedTeamSetup
      onBack={props.onBack}
      onCreated={onTeamCreated}
      onManual={() => {
        setMode('manual');
        const next = new URLSearchParams(params.toString());
        next.set('view', 'add');
        next.set('manual', '1');
        router.replace(`/settings?${next.toString()}`, { scroll: false });
      }}
    />
  );
}
