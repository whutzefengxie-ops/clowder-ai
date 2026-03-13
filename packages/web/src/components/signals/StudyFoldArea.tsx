import type { StudyMeta } from '@cat-cafe/shared';
import { useCallback, useRef, useState } from 'react';
import { PodcastPlayer } from './PodcastPlayer';

interface StudyFoldAreaProps {
  readonly articleId: string;
  readonly studyMeta: StudyMeta | null;
  readonly onStartStudy: () => void;
  readonly onLinkThread?: (threadId: string) => Promise<void>;
  readonly onUnlinkThread?: (threadId: string) => Promise<void>;
  readonly collections?: readonly { id: string; name: string }[] | undefined;
  readonly onAddToCollection?: (collectionId: string) => Promise<void>;
  readonly onCreateCollection?: (name: string) => Promise<void>;
  readonly onStudyMetaRefresh?: () => void;
}

function formatDate(iso: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function StudyFoldArea({
  articleId,
  studyMeta,
  onStartStudy,
  onLinkThread,
  onUnlinkThread,
  collections,
  onAddToCollection,
  onCreateCollection,
  onStudyMetaRefresh,
}: StudyFoldAreaProps) {
  const [open, setOpen] = useState(!!studyMeta?.lastStudiedAt);
  const [linkInput, setLinkInput] = useState('');
  const [newCollectionName, setNewCollectionName] = useState('');
  const linkInputRef = useRef<HTMLInputElement>(null);

  const handleLinkThread = useCallback(async () => {
    const tid = linkInput.trim();
    if (!tid || !onLinkThread) return;
    await onLinkThread(tid);
    setLinkInput('');
  }, [linkInput, onLinkThread]);

  const threads = studyMeta?.threads ?? [];
  const artifacts = studyMeta?.artifacts ?? [];
  const notes = artifacts.filter((a) => a.kind === 'note');
  const podcasts = artifacts.filter((a) => a.kind === 'podcast');
  const reports = artifacts.filter((a) => a.kind === 'research-report');

  const hasContent = threads.length > 0 || artifacts.length > 0;
  const studyCount = threads.length + artifacts.length;

  return (
    <section className="mt-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center justify-between rounded-t-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-xs font-semibold text-gray-700"
      >
        <span>
          {open ? '▾' : '▸'} 学习区
          {studyCount > 0 && <span className="ml-1 text-opus-dark">({studyCount})</span>}
        </span>
        {studyMeta?.lastStudiedAt && (
          <span className="text-xs font-normal text-gray-400">上次学习: {formatDate(studyMeta.lastStudiedAt)}</span>
        )}
      </button>
      {open && (
        <div className="rounded-b-lg border border-t-0 border-gray-200 bg-gray-50 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onStartStudy}
              className="rounded-md bg-opus-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-opus-dark"
            >
              开始学习
            </button>
            <a
              href={`/thread/default?signal=${encodeURIComponent(articleId)}`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
            >
              在对话中讨论
            </a>
            {/* AC-6: 多猫研究派发 — signal param binds article context via activeSignals */}
            <a
              href={`/thread/default?signal=${encodeURIComponent(articleId)}&research=multi`}
              className="rounded-md border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50"
            >
              多猫研究
            </a>
          </div>

          {threads.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-gray-500">关联对话</h4>
              <ul className="mt-1 space-y-1">
                {threads.map((t) => (
                  <li key={t.threadId} className="flex items-center gap-1">
                    <a
                      href={`/thread/${encodeURIComponent(t.threadId)}`}
                      className="flex flex-1 items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-opus-dark hover:bg-opus-bg"
                    >
                      <span className="truncate">{t.threadId}</span>
                      <span className="ml-2 shrink-0 text-gray-400">{formatDate(t.linkedAt)}</span>
                    </a>
                    {onUnlinkThread && (
                      <button
                        type="button"
                        onClick={() => void onUnlinkThread(t.threadId)}
                        className="shrink-0 rounded border border-red-200 px-1.5 py-1 text-[10px] text-red-500 hover:bg-red-50"
                        title="取消关联"
                      >
                        ×
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {onLinkThread && (
            <div className="mt-3 flex gap-2">
              <input
                ref={linkInputRef}
                value={linkInput}
                onChange={(e) => setLinkInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleLinkThread();
                  }
                }}
                placeholder="输入 Thread ID 关联..."
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => void handleLinkThread()}
                className="rounded-md border border-opus-light px-2 py-1 text-xs text-opus-dark hover:bg-opus-bg"
              >
                关联
              </button>
            </div>
          )}

          {notes.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-gray-500">学习笔记</h4>
              <ul className="mt-1 space-y-1">
                {notes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700"
                  >
                    <span className="font-medium">{n.id}</span>
                    <span className="ml-2 text-gray-400">
                      {n.state} · {formatDate(n.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AC-5: 播客播放器 */}
          <PodcastPlayer articleId={articleId} podcasts={podcasts} onArtifactCreated={onStudyMetaRefresh} />

          {reports.length > 0 && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-gray-500">研究报告</h4>
              <ul className="mt-1 space-y-1">
                {reports.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700"
                  >
                    <span className="font-medium">{r.id}</span>
                    <span className="ml-2 text-gray-400">
                      {r.state} · {formatDate(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AC-18: 学习集 */}
          {(studyMeta?.collections?.length ?? 0) > 0 && collections && (
            <div className="mt-3">
              <h4 className="text-xs font-semibold text-gray-500">所属学习集</h4>
              <ul className="mt-1 flex flex-wrap gap-1">
                {studyMeta?.collections?.map((colId) => {
                  const col = collections.find((c) => c.id === colId);
                  return (
                    <li
                      key={colId}
                      className="rounded-full border border-opus-light bg-opus-bg px-2 py-0.5 text-xs text-opus-dark"
                    >
                      {col?.name ?? colId}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {onAddToCollection && collections && collections.length > 0 && (
            <div className="mt-2">
              <select
                onChange={(e) => {
                  if (e.target.value) void onAddToCollection(e.target.value);
                  e.target.value = '';
                }}
                className="rounded-md border border-gray-200 px-2 py-1 text-xs"
                defaultValue=""
              >
                <option value="" disabled>
                  加入学习集...
                </option>
                {collections
                  .filter((c) => !studyMeta?.collections?.includes(c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </div>
          )}

          {onCreateCollection && (
            <div className="mt-2 flex gap-2">
              <input
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter' && newCollectionName.trim()) {
                    e.preventDefault();
                    void onCreateCollection(newCollectionName.trim());
                    setNewCollectionName('');
                  }
                }}
                placeholder="新建学习集..."
                className="flex-1 rounded-md border border-gray-200 px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => {
                  if (newCollectionName.trim()) {
                    void onCreateCollection(newCollectionName.trim());
                    setNewCollectionName('');
                  }
                }}
                className="rounded-md border border-opus-light px-2 py-1 text-xs text-opus-dark hover:bg-opus-bg"
              >
                创建
              </button>
            </div>
          )}

          {!hasContent && !studyMeta?.collections?.length && (
            <p className="mt-3 text-xs text-gray-400">还没有学习记录，点击「开始学习」开始吧。</p>
          )}
        </div>
      )}
    </section>
  );
}
