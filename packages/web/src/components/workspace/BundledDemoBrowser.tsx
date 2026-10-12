'use client';

import { useEffect, useRef, useState } from 'react';
import { DEMO_DELIVERABLE_HTML } from '../onboarding-demo/demo-deliverable';

/** Only a fixed, bundled page can enter this mode; it never probes local services. */
export function BundledDemoBrowser({ onReady }: { onReady?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const readyCallback = useRef(onReady);
  readyCallback.current = onReady;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    setStatus('loading');
    const timeout = setTimeout(() => setStatus('failed'), 10_000);
    const receive = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        event.source !== frame.current?.contentWindow ||
        !data ||
        typeof data !== 'object' ||
        !('type' in data) ||
        data.type !== 'clowder-onboarding-ready' ||
        !('version' in data) ||
        data.version !== 1
      )
        return;
      clearTimeout(timeout);
      setStatus('ready');
      readyCallback.current?.();
    };
    window.addEventListener('message', receive);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
  }, [attempt]);
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="演示成果浏览器">
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--console-border-soft)] bg-[var(--console-panel-bg)] px-4 py-3 text-xs">
        <span className="font-semibold">浏览器 · 今天待办</span>
        <span className="rounded bg-[var(--console-xray-bg)] px-2 py-1 text-[var(--console-xray-text)]">预置成果</span>
        <span className="min-w-0 flex-1 truncate text-cafe-secondary">内置示例 / 今天待办</span>
        <button
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
          className="rounded-lg border border-[var(--console-border-soft)] px-3 py-1.5"
        >
          重新打开
        </button>
      </div>
      {status !== 'ready' && (
        <div
          role="status"
          className="bg-[var(--semantic-warning-surface)] px-4 py-2 text-sm text-[var(--semantic-warning)]"
        >
          {status === 'loading' ? '正在打开成果…' : '成果暂时没有打开。请点击“重新打开”，无需安装或登录任何工具。'}
        </div>
      )}
      <iframe
        key={attempt}
        ref={frame}
        title="今天待办 · 演示成果"
        srcDoc={DEMO_DELIVERABLE_HTML}
        sandbox="allow-scripts"
        onError={() => setStatus('failed')}
        className="min-h-0 w-full flex-1 border-0 bg-[var(--console-card-bg)]"
      />
    </section>
  );
}
