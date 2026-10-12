import { DEMO_SETTINGS_URL } from './demo-story';

export function DemoInvitation({ onSkip, onStart }: { onSkip: () => void; onStart: () => void }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--console-overlay-medium)] px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-conn-amber-ring bg-[var(--console-card-bg)] p-6 shadow-2xl">
        <h3 className="text-lg font-semibold text-cafe">先看看猫猫如何一起完成任务</h3>
        <p className="mt-2 text-sm text-cafe-secondary">
          用约 40 秒看一次分工、传球与互审，再亲手试试成果。无需安装工具，也可以直接创建自己的伙伴。
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={onSkip} className="px-3 py-2 text-sm text-cafe-secondary">
            稍后再看
          </button>
          <a
            href={DEMO_SETTINGS_URL}
            onClick={onSkip}
            className="rounded-lg border border-[var(--console-border-soft)] px-3 py-2 text-sm text-cafe-accent"
          >
            直接创建我的猫猫
          </a>
          <button
            type="button"
            onClick={onStart}
            className="rounded-lg bg-cafe-accent px-3 py-2 text-sm font-medium text-[var(--cafe-surface)] hover:opacity-90"
          >
            看看团队如何协作
          </button>
        </div>
      </div>
    </div>
  );
}
