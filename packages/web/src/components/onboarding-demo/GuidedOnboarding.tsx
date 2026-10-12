'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BrowserPanel } from '@/components/workspace/BrowserPanel';
import { DemoTeam } from './DemoTeam';
import { DemoTranscript } from './DemoTranscript';
import { DemoWorkProduct } from './DemoWorkProduct';
import { DEMO_EVENTS, DEMO_SETTINGS_URL, type DemoCat } from './demo-story';
import { useDemoPlayback } from './useDemoPlayback';

interface Props {
  open: boolean;
  storageScope: string;
  onClose: () => void;
}
export function GuidedOnboarding({ open, storageScope, onClose }: Props) {
  return open ? <DemoPlayer key={storageScope} storageScope={storageScope} onClose={onClose} /> : null;
}

function DemoPlayer({ storageScope, onClose }: Omit<Props, 'open'>) {
  const playback = useDemoPlayback(storageScope);
  const [delivered, setDelivered] = useState(false);
  const [view, setView] = useState<'conversation' | 'result'>('conversation');
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const playbackControl = useRef<HTMLButtonElement>(null);
  const started = playback.index >= 0;
  useEffect(() => {
    const previous = document.activeElement;
    close.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (playback.finished) setView('result');
  }, [playback.finished]);
  useEffect(() => {
    // Starting/replaying or auto-finishing can remove the focused control.
    // Keep keyboard users in the dialog instead of returning to the background.
    if (started && document.activeElement === document.body) {
      (playback.finished ? close : playbackControl).current?.focus();
    }
  }, [started, playback.finished]);
  const events = DEMO_EVENTS.slice(0, playback.index + 1);
  const current = DEMO_EVENTS[playback.index];
  const active =
    current && current.speaker !== 'user' && current.speaker !== 'system' ? (current.speaker as DemoCat) : undefined;
  const stage = [...events].reverse().find((event) => event.artifact)?.artifact;
  const replay = () => {
    setDelivered(false);
    setView('conversation');
    playback.start();
  };
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--console-overlay-medium)] p-2 backdrop-blur-sm sm:p-5">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guided-demo-title"
        className="flex h-[94dvh] max-h-[900px] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-[var(--console-card-bg)] text-cafe shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key !== 'Tab') return;
          const controls = [
            ...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], iframe') ?? []),
          ].filter((element) => element.getClientRects().length > 0);
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="flex items-start justify-between gap-3 px-4 pt-5 sm:px-6">
          <div>
            <p className="text-xs font-medium text-cafe-accent">预置演示 · 不调用模型</p>
            <h2 id="guided-demo-title" className="mt-1 text-xl font-semibold">
              看猫猫一起把事情做好
            </h2>
            {view === 'conversation' && (
              <p className="mt-1 text-xs leading-5 text-cafe-secondary">先体验协作，再创建自己的团队。无需安装工具。</p>
            )}
          </div>
          <button
            ref={close}
            type="button"
            aria-label="关闭引导"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-xl text-cafe-secondary hover:bg-[var(--console-hover-bg)]"
          >
            ×
          </button>
        </header>
        {view === 'conversation' && <DemoTeam active={active} />}
        <div className="flex min-h-10 items-center justify-between gap-2 border-y border-[var(--console-border-soft)] px-4 py-2 text-xs sm:px-6">
          <span role="status">
            {playback.finished
              ? '审查通过 · 试试团队交付的成果'
              : current
                ? `${playback.index + 1} / ${DEMO_EVENTS.length} · ${current.title}`
                : '准备好后，整个协作过程会自动进行'}
          </span>
          {playback.finished && (
            <button
              type="button"
              className="shrink-0 font-semibold text-cafe-accent"
              onClick={() => setView(view === 'result' ? 'conversation' : 'result')}
            >
              {view === 'result' ? '回看协作过程' : '查看成果'}
            </button>
          )}
        </div>
        <div className={view === 'conversation' ? 'flex min-h-0 flex-1' : 'hidden'}>
          <DemoTranscript events={events} playing={!playback.paused} />
          <DemoWorkProduct stage={stage} />
        </div>
        {playback.finished && (
          <div className={view === 'result' ? 'min-h-0 flex-1' : 'hidden'}>
            <BrowserPanel bundledPage="onboarding-todo" onBundledReady={() => setDelivered(true)} />
          </div>
        )}
        <footer className="border-t border-[var(--console-border-soft)] px-4 py-3 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} className="text-sm text-cafe-secondary">
              稍后再看
            </button>
            <div className="flex items-center gap-3">
              {playback.index === -1 && (
                <button
                  disabled={!playback.ready}
                  type="button"
                  onClick={playback.start}
                  className="rounded-full bg-cafe-accent px-5 py-2.5 text-sm font-semibold text-[var(--cafe-surface)]"
                >
                  开始引导
                </button>
              )}
              {playback.index >= 0 && !playback.finished && (
                <button
                  ref={playbackControl}
                  type="button"
                  onClick={playback.toggle}
                  className="rounded-full bg-cafe-accent px-5 py-2.5 text-sm font-semibold text-[var(--cafe-surface)]"
                >
                  {playback.paused ? '继续' : '暂停'}
                </button>
              )}
              {playback.finished && (
                <button type="button" onClick={replay} className="text-sm text-cafe-secondary">
                  重新看一遍
                </button>
              )}
              {delivered && (
                <a
                  href={DEMO_SETTINGS_URL}
                  className="rounded-full bg-cafe-accent px-4 py-2.5 text-sm font-semibold text-[var(--cafe-surface)]"
                >
                  创建我的猫猫 →
                </a>
              )}
            </div>
          </div>
          {delivered && (
            <p className="mt-2 text-xs leading-5 text-cafe-secondary">
              演示团队使用预置数据。接下来在设置中接入你自己的工具，创建真实伙伴。
            </p>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
