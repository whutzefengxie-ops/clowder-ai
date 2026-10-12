'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NativePartnerCard } from './first-run-quest/NativePartnerCard';
import { SMALL_GOALS } from './first-run-quest/native-onboarding';
import { useNativeOnboarding } from './first-run-quest/useNativeOnboarding';

interface FirstRunQuestWizardProps {
  open: boolean;
  onClose: () => void;
  onCreated: (threadId: string, catName: string) => void;
}

export function FirstRunQuestWizard({ open, onClose, onCreated }: FirstRunQuestWizardProps) {
  const setup = useNativeOnboarding(open, onCreated);
  const [step, setStep] = useState<'partners' | 'goal'>('partners');
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    setStep('partners');
    const previous = document.activeElement;
    close.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, [open]);
  if (!open) return null;
  const { draft, loading, busy, error } = setup;
  const selected = draft?.partners.filter((p) => p.selected) ?? [];
  const invalidSelection = selected.some((p) => invalid[p.id] || !p.form.displayName.trim());
  const lead = selected.find((p) => p.id === draft?.lead) ?? selected[0];

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--console-overlay-medium)] px-3 py-4 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-setup-title"
        className="flex max-h-[92dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--console-border-soft)] bg-[var(--console-card-bg)] text-cafe shadow-2xl"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !busy) onClose();
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea, select, summary, a[href]',
            ),
          ).filter((element) => element.getClientRects().length > 0);
          const first = controls[0],
            last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[var(--console-border-soft)] px-6 py-5">
          <div>
            <p className="mb-2 text-xs text-cafe-muted">
              {step === 'partners' ? '1 / 2 · 配置伙伴' : '2 / 2 · 第一个小目标'}
            </p>
            <h2 id="native-setup-title" className="text-xl font-semibold">
              {step === 'partners' ? '把你的工具，变成一起做事的伙伴' : '一起完成一件小事'}
            </h2>
            <p className="mt-2 text-sm text-cafe-secondary">
              {step === 'partners'
                ? '已安装的工具会自动推荐。选择要加入的伙伴，模型和思考强度默认跟随工具。'
                : '从一个具体、可完成的目标开始。你可以改写内容，再交给伙伴。'}
            </p>
          </div>
          <button
            ref={close}
            type="button"
            aria-label="关闭伙伴配置"
            disabled={Boolean(busy)}
            onClick={onClose}
            className="min-h-10 min-w-10 rounded-lg text-xl text-cafe-muted hover:bg-[var(--console-hover-bg)]"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <div
              role="alert"
              className="mb-4 rounded-xl border border-conn-red-ring bg-conn-red-bg p-3 text-sm text-conn-red-text"
            >
              {error}
              <p className="mt-1">已保存的伙伴会保留，可以重试。</p>
              <button type="button" disabled={Boolean(busy)} onClick={setup.reload} className="mt-2 underline">
                重新检测
              </button>
            </div>
          )}
          {loading ? (
            <p role="status" className="py-12 text-center text-cafe-muted">
              正在检测本机工具…
            </p>
          ) : step === 'partners' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">推荐伙伴 · 已选择 {selected.length} 位</span>
                <button type="button" onClick={setup.reload} className="min-h-10 text-cafe-accent">
                  重新检测
                </button>
              </div>
              {draft?.partners.map((partner) => (
                <NativePartnerCard
                  key={partner.id}
                  partner={partner}
                  created={Boolean(draft.created[partner.id] || partner.existingId)}
                  patch={(change) => setup.patchPartner(partner.id, change)}
                  onValidityChange={(valid) =>
                    setInvalid((current) =>
                      current[partner.id] === !valid ? current : { ...current, [partner.id]: !valid },
                    )
                  }
                />
              ))}
              {!selected.length && (
                <p className="rounded-lg bg-cafe-surface-canvas p-4 text-sm text-cafe-secondary">
                  选择至少一位伙伴继续。没有找到工具？可以先在工具中完成安装和登录，再回来重新检测。
                </p>
              )}
              <p className="pt-2 text-xs leading-relaxed text-cafe-muted">
                使用各工具已有的连接与登录配置；是否可正常调用，将在第一次真实对话中验证。以后可在“设置 →
                成员与运行时”继续调整。
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {SMALL_GOALS.map((goal) => (
                  <button
                    key={goal.title}
                    type="button"
                    onClick={() => setup.patch({ goal: goal.content })}
                    className={`min-h-10 rounded-full border px-4 text-sm ${draft?.goal === goal.content ? 'border-cafe-accent text-cafe-accent' : 'border-[var(--console-border-soft)] text-cafe-secondary'}`}
                  >
                    {goal.title}
                  </button>
                ))}
              </div>
              <label className="block text-sm font-medium">
                你想完成什么？
                <textarea
                  value={draft?.goal ?? ''}
                  onChange={(e) => setup.patch({ goal: e.target.value })}
                  placeholder="例如：把我的想法整理为今天可以完成的三步计划"
                  rows={5}
                  maxLength={4000}
                  className="mt-3 w-full resize-y rounded-xl border border-[var(--console-border-soft)] bg-cafe-surface-canvas p-4 font-normal leading-relaxed focus:border-cafe-accent"
                />
              </label>
              <label className="block text-sm font-medium">
                先和哪位伙伴开始？
                <select
                  value={lead?.id ?? ''}
                  onChange={(e) => setup.patch({ lead: e.target.value })}
                  className="mt-3 block min-h-11 w-full rounded-lg border border-[var(--console-border-soft)] bg-cafe-surface-canvas px-3 font-normal"
                >
                  {selected.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.form.displayName} · {p.runtime.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-xl bg-cafe-surface-canvas p-4 text-sm leading-relaxed text-cafe-secondary">
                将添加 {selected.length}{' '}
                位伙伴并打开一段真实对话。目标会放进输入框，确认发送即可开始；其他伙伴也可以在对话中通过 @ 邀请。
              </div>
            </div>
          )}
        </div>
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-[var(--console-border-soft)] px-6 py-4">
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={step === 'goal' ? () => setStep('partners') : onClose}
            className="min-h-11 rounded-lg px-3 text-sm text-cafe-secondary"
          >
            {step === 'goal' ? '返回选择伙伴' : '稍后配置'}
          </button>
          <button
            type="button"
            disabled={
              loading ||
              Boolean(busy) ||
              !selected.length ||
              invalidSelection ||
              (step === 'goal' && !draft?.goal.trim())
            }
            onClick={step === 'partners' ? () => setStep('goal') : () => void setup.start()}
            className="min-h-11 rounded-xl bg-cafe-accent px-5 text-sm font-medium text-[var(--cafe-surface)] disabled:opacity-50"
          >
            <span role="status">
              {busy || (step === 'partners' ? `下一步 · 为 ${selected.length} 位伙伴设定小目标` : '保存伙伴，前往对话')}
            </span>
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
