'use client';
import { RoutingContextLedger } from '@/components/routing-context/RoutingContextLedger';
import type { CatData } from '@/hooks/useCatData';
import type { MemberSaveTrace } from '@/utils/member-save-trace';
import { CatOverviewTab, type ConfigData } from '../../config-viewer-tabs';
import { MemberCopyProvider } from '../../members/editor-presentation';
import { MemberListHost } from '../../members/MemberListHost';
import { useMemberReturn } from '../../members/useMemberReturn';
import { OpenTeamWorkspaceButton } from '../OpenTeamWorkspaceButton';
import { MemberCreationPage } from './MemberCreationPage';
import { MemberSettingsPage } from './MemberSettingsPage';

export function MemberSettingsHost({
  v2,
  editorOpen,
  editingCat,
  cats,
  config,
  configError,
  registryLoading,
  registryKnown,
  creationView,
  onRetryConfig,
  onRetryRegistry,
  onOpen,
  onClose,
  onSaved,
  onTeamCreated,
  onEditCoCreator,
  onDelete,
  onToggle,
  togglingCatId,
}: {
  v2: boolean;
  editorOpen: boolean;
  editingCat: CatData | null;
  cats: CatData[];
  config: ConfigData | null;
  configError: string | null;
  registryLoading: boolean;
  registryKnown: boolean;
  creationView: string | null;
  onRetryConfig: () => void;
  onRetryRegistry: () => void;
  onOpen: (cat: CatData | null) => void;
  onClose: () => void;
  onSaved: (cat: CatData, trace?: MemberSaveTrace) => Promise<void>;
  onTeamCreated: () => Promise<void>;
  onEditCoCreator: () => void;
  onDelete: (cat: CatData) => void;
  onToggle: (cat: CatData) => void;
  togglingCatId: string | null;
}) {
  const returnToList = useMemberReturn();
  const open = (cat: CatData | null) => {
    returnToList.remember();
    onOpen(cat);
  };
  const close = () => {
    onClose();
    returnToList.restore();
  };
  return (
    <MemberCopyProvider>
      <div ref={returnToList.host}>
        {v2 ? (
          <MemberListHost
            hidden={editorOpen}
            registryLoading={registryLoading}
            registryKnown={registryKnown}
            onRetryRegistry={onRetryRegistry}
            config={config}
            configError={configError}
            onRetryConfig={onRetryConfig}
            cats={cats}
            onAdd={() => open(null)}
            onEdit={open}
            onEditCoCreator={onEditCoCreator}
            onToggle={onToggle}
            togglingCatId={togglingCatId}
          />
        ) : (
          <div hidden={editorOpen} className="space-y-8">
            {configError ? (
              <p role="alert">{configError}</p>
            ) : config ? (
              <CatOverviewTab
                config={config}
                cats={cats}
                onEditMember={open}
                onEditCoCreator={onEditCoCreator}
                onDeleteMember={onDelete}
                onToggleAvailability={onToggle}
                togglingCatId={togglingCatId}
              />
            ) : (
              <p role="status">加载中...</p>
            )}
            <div className="space-y-3">
              <div className="flex justify-end">
                <OpenTeamWorkspaceButton />
              </div>
              <details className="rounded-xl border border-[var(--console-border-soft)] p-4">
                <summary className="cursor-pointer text-sm text-cafe-secondary">查看路由记录</summary>
                <div className="mt-4">
                  <RoutingContextLedger />
                </div>
              </details>
            </div>
          </div>
        )}
        {editorOpen &&
          (editingCat ? (
            <MemberSettingsPage key={editingCat.id} cat={editingCat} cats={cats} onBack={close} onSaved={onSaved} />
          ) : (
            <MemberCreationPage
              key={creationView}
              cats={cats}
              onBack={close}
              onTeamCreated={async () => {
                await onTeamCreated();
                close();
              }}
              onSaved={async (cat, trace) => {
                await onSaved(cat, trace);
                close();
              }}
            />
          ))}
      </div>
    </MemberCopyProvider>
  );
}
