'use client';

import { useState } from 'react';
import styles from './RealChatEntry.module.css';

interface RealChatEntryProps {
  members: Array<{ client: string; cat: string }>;
  onStart: () => void;
}

/**
 * 场景 8: 第一次真实交流（自由聊天）
 * 用户可自由输入，入口提醒非阻塞
 */
export function RealChatEntry({ members, onStart }: RealChatEntryProps) {
  const [showTip, setShowTip] = useState(true);
  const [message, setMessage] = useState('');

  const frontCat = members[0]?.cat || '暹罗猫';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    // 用户发送第一句话后，进入真实聊天界面
    onStart();
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>你的第一次交流</h1>
        <span className={styles.realBadge}>真实模型 · 开始协作</span>
      </div>

      <div className={styles.scene}>
        <h2>8. 第一次真实交流（自由聊天）</h2>
        <p className={styles.lead}>从这里开始不再是强制课程。你可以自由发消息；入口提醒不会遮挡输入框。</p>

        <div className={styles.stage}>
          <div className={styles.chat}>
            <div className={styles.msgCat}>{frontCat}：我已经准备好和你一起做事了。你可以直接说一个目标。</div>
          </div>

          {showTip && (
            <div className={styles.tip}>
              <span>提示：之后可以从左侧"成员""密钥"管理伙伴和账号。</span>
              <button type="button" onClick={() => setShowTip(false)} className={styles.dismissButton}>
                知道了
              </button>
            </div>
          )}

          <form className={styles.compose} onSubmit={handleSubmit}>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="输入你的第一句话，例如：帮我整理一个欢迎页"
              rows={3}
              className={styles.messageInput}
            />
            <div className={styles.actions}>
              <button type="submit" className={styles.primaryButton} disabled={!message.trim()}>
                发送
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
