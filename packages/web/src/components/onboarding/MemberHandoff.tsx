'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/utils/api-client';
import styles from './MemberHandoff.module.css';

interface MemberHandoffProps {
  selectedClients: Array<{ name: string; id: string; provider: string }>;
  onComplete: (members: Array<{ client: string; cat: string }>) => void;
}

const CAT_NAMES = ['暹罗猫', '布偶猫', '缅因猫'];

/**
 * 场景 7: 从示范团队交接到我的伙伴
 * 明确区分示范团队和真实团队
 */
export function MemberHandoff({ selectedClients, onComplete }: MemberHandoffProps) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 生成成员映射（client → cat）
  const members = selectedClients.map((client, index) => ({
    client: client.name,
    cat: CAT_NAMES[index % CAT_NAMES.length],
  }));

  const handleContinue = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      // 调用后端 API 批量创建成员
      await apiFetch('/api/members/batch', {
        method: 'POST',
        body: JSON.stringify({
          members: selectedClients.map((client) => ({
            provider: client.provider,
            client: client.id,
          })),
        }),
      });
      onComplete(members);
    } catch (err) {
      setError(err instanceof Error ? err.message : '成员创建失败');
      setCreating(false);
    }
  }, [selectedClients, members, onComplete]);

  const handoffText =
    members.length === 1
      ? '先从你和它开始，之后可以再邀请更多伙伴。'
      : `已按你的选择配置 ${members.length} 位真实伙伴。未选择的演示猫不会出现在成员列表。`;

  const memberList = members.map((m) => `${m.cat}（${m.client}）`).join('、');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>看懂一次协作，再得到自己的伙伴</h1>
        <span className={styles.mockBadge}>演示数据 · 不调用真实模型</span>
      </div>

      <div className={styles.scene}>
        <h2>7. 从示范团队交接到我的伙伴</h2>
        <p className={styles.lead}>示范猫不会冒充真实成员；解说猫自然留下成为前台猫。</p>

        <div className={styles.stage}>
          <div className={styles.handoff}>
            <div className={`${styles.face} ${styles.siamese}`}>暹</div>
            <div className={styles.handoffText}>
              <b>{memberList} 已加入你的团队</b>
              <p>{handoffText}</p>
              <p className={styles.boundary}>刚才是示范，从这里开始，就是与你自己的猫交流了。</p>
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={handleContinue} className={styles.primaryButton} disabled={creating}>
            {creating ? '正在配置成员...' : '进入真实主界面'}
          </button>
        </div>
      </div>
    </div>
  );
}
