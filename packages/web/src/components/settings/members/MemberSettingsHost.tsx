'use client';
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
  onDetect,
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
  onDetect?: () => void;
  onClose: () => void;
  onSaved: (cat: CatData, trace?: MemberSaveTrace) => Promise<void>;
  onTeamCreated: () => Promise<void>;
  onEditCoCreator: () => void;
  onDelete: (cat: CatData) => Promise<boolean>;
  onToggle: (cat: CatData) => void;
  togglingCatId: string | null;
}) {
  const returnToList = useMemberReturn();
  const open = (cat: CatData | null) => {
    returnToList.remember();
    onOpen(cat);
  };
  const detect = () => {
    returnToList.remember();
    onDetect?.();
  };
  const close = () => {
    onClose();
    returnToList.restore();
  };
  return (
    <MemberCopyProvider>
      <div ref={returnToList.host}>
        {config && configError && (
          <p role="alert" className="mb-4 rounded-xl bg-conn-red-bg p-4 text-sm text-conn-red-text">
            {configError}
          </p>
        )}
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
            onDetect={detect}
            onEdit={open}
            onEditCoCreator={onEditCoCreator}
            onToggle={onToggle}
            togglingCatId={togglingCatId}
          />
        ) : (
          <div hidden={editorOpen} className="space-y-8">
            {configError ? (
              <p role="alert">{configError}</p>
            ) : config && !registryKnown ? (
              <p role="status">
                {registryLoading ? '正在读取成员名单…' : '成员名单读取失败'}
                {!registryLoading && (
                  <button type="button" onClick={onRetryRegistry} className="ml-3 text-cafe-accent">
                    重试
                  </button>
                )}
              </p>
            ) : config && cats.length === 0 ? (
              <section className="rounded-xl border border-[var(--console-border-soft)] bg-[var(--console-card-bg)] p-6">
                <h2 className="text-lg font-semibold">还没有成员</h2>
                <p className="mt-2 text-sm text-cafe-secondary">
                  检测本机工具，选择要加入的伙伴；项目自带角色模板仅在确认添加后成为成员。
                </p>
                <div className="mt-4 flex flex-wrap gap-4">
                  <button
                    type="button"
                    className="text-sm font-semibold text-cafe-accent"
                    onClick={onDetect ? detect : () => open(null)}
                  >
                    一键检测本机工具
                  </button>
                  <button type="button" className="text-sm text-cafe-secondary" onClick={() => open(null)}>
                    手动添加成员
                  </button>
                </div>
              </section>
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
            </div>
          </div>
        )}
        {editorOpen &&
          (editingCat ? (
            <MemberSettingsPage
              key={editingCat.id}
              cat={editingCat}
              cats={cats}
              onBack={close}
              onSaved={onSaved}
              onDelete={async () => {
                if (await onDelete(editingCat)) close();
              }}
            />
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
