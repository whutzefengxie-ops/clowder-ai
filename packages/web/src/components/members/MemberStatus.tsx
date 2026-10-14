import { useMembersCopy, useMemberText } from './editor-presentation';
import type { MemberStatus as Status } from './member-projection';
export function MemberStatus({ status }: { status: Status }) {
  const t = useMemberText();
  const copy = useMembersCopy();
  const detail = [
    status.detailIsNote ? status.detail : t(status.detail),
    status.source && t(status.source),
    status.until !== undefined && copy.until(status.until),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="member-status" data-tone={status.tone}>
      <span className="member-status-label">
        <i aria-hidden="true" />
        {t(status.label)}
      </span>
      {detail && (
        <details className="member-status-detail">
          <summary>{t('状态详情')}</summary>
          <small>{detail}</small>
        </details>
      )}
    </span>
  );
}
