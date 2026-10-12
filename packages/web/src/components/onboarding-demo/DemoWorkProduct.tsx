import type { DemoArtifact } from './demo-story';

const labels: Record<DemoArtifact, string> = {
  design: '设计方案',
  architecture: '方案已整合',
  initial: '第一版 · 等待审查',
  review: '互审 · 发现问题',
  final: '修正后的成果',
};
export function DemoWorkProduct({ stage }: { stage?: DemoArtifact }) {
  return (
    <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-[var(--console-border-soft)] bg-[var(--console-panel-bg)] p-5 lg:block">
      <p className="text-xs font-semibold tracking-wider text-cafe-secondary">同一个成果，一步步变好</p>
      <div className="mt-4 rounded-2xl border border-[var(--console-border-soft)] bg-[var(--console-card-bg)] p-4 shadow-sm">
        <div className="text-lg font-semibold">今天待办</div>
        <p className="mt-1 text-xs text-cafe-secondary">{stage ? labels[stage] : '等待团队接单'}</p>
        <div className="mt-5 rounded-lg border border-dashed border-[var(--console-border-strong)] p-2 text-xs text-cafe-secondary">
          添加一件小事…　＋
        </div>
        <div className="mt-4 space-y-3 text-sm">
          <p>○ 整理今天的想法</p>
          <p>○ 完成第一件小事</p>
        </div>
      </div>
      {stage === 'design' && (
        <p className="mt-4 text-sm leading-6">设计师确定添加、勾选和筛选的布局，也提出了空状态的要求。</p>
      )}
      {stage === 'architecture' && (
        <p className="mt-4 text-sm leading-6">架构师整合设计：无需登录，任务有独立 ID，输入自动去掉首尾空格。</p>
      )}
      {stage === 'initial' && <p className="mt-4 text-sm leading-6">主要功能已实现，交回架构师检查边界情况。</p>}
      {stage === 'review' && (
        <div className="mt-4 rounded-xl bg-[var(--semantic-warning-surface)] p-3 text-sm leading-6 text-[var(--semantic-warning)]">
          待修正
          <br />① 全部完成后列表空白
          <br />② 空白输入没有反馈
        </div>
      )}
      {stage === 'final' && (
        <div className="mt-4 rounded-xl bg-[var(--semantic-success-surface)] p-3 text-sm leading-6 text-[var(--semantic-success)]">
          已修正
          <br />✓ 完成提示“今天的任务都完成了”
          <br />✓ 输入提示“先写下一件小事”
        </div>
      )}
      <p className="mt-5 text-xs leading-5 text-cafe-secondary">这是预置演示。交付后会打开可操作的完整页面。</p>
    </aside>
  );
}
