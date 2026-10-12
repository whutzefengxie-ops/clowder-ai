'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useCatData } from '@/hooks/useCatData';
import { MemberSettingsPage } from './MemberSettingsPage';
import { RecommendedTeamSetup } from './RecommendedTeamSetup';

/** Keep first-run selection stable while a partially created roster refreshes. */
export function MemberCreationPage({
  onTeamCreated,
  ...props
}: Omit<Parameters<typeof MemberSettingsPage>[0], 'cat'> & { onTeamCreated: () => Promise<void> }) {
  const params = useSearchParams();
  const router = useRouter();
  const { hasFetched, isLoading, refresh } = useCatData();
  const [mode, setMode] = useState<'team' | 'manual' | null>(
    params.get('manual') === '1' ? 'manual' : params.get('view') === 'setup' ? 'team' : null,
  );
  useEffect(() => {
    if (mode === null && hasFetched) setMode(props.cats.length ? 'manual' : 'team');
  }, [mode, hasFetched, props.cats.length]);
  if (mode === null)
    return (
      <div role="status" className="p-6 text-sm">
        {isLoading ? '正在读取已有伙伴…' : '暂时无法读取伙伴配置。'}
        {!isLoading && (
          <button type="button" onClick={() => void refresh()} className="ml-4 text-cafe-accent">
            重试
          </button>
        )}
      </div>
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
