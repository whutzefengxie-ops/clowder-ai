'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';
import styles from './ClientSetup.module.css';

interface DetectedClient {
  name: string;
  id: string;
  provider: string;
  installed: boolean;
  authStatus: 'ready' | 'pending' | 'login_required' | 'not_installed';
}

interface ClientSetupProps {
  onComplete: (clients: Array<{ name: string; id: string; provider: string }>) => void;
}

/**
 * 场景 6: 检测本机 client
 * 真实探测 CLI 安装和登录状态
 */
export function ClientSetup({ onComplete }: ClientSetupProps) {
  const [clients, setClients] = useState<DetectedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 探测本机 client
  const detectClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<{ clients: DetectedClient[] }>('/api/clients/detect');
      setClients(response.clients);

      // 自动选择已登录的 client
      const autoSelected = new Set(response.clients.filter((c) => c.authStatus === 'ready').map((c) => c.id));
      setSelected(autoSelected);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Client 探测失败');
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    detectClients();
  }, [detectClients]);

  const handleToggle = useCallback((clientId: string, authStatus: string) => {
    if (authStatus !== 'ready') return; // 只能选择已登录的
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(clientId)) {
        next.delete(clientId);
      } else {
        next.add(clientId);
      }
      return next;
    });
  }, []);

  const handleLogin = useCallback(async (clientId: string) => {
    // 拉起 CLI 登录流程
    setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, authStatus: 'pending' as const } : c)));

    // TODO: 实际拉起 CLI 登录命令
    // 这里应该调用后端 API 启动登录流程
    console.log('TODO: Launch login for', clientId);
  }, []);

  const handleSimulateLoginComplete = useCallback((clientId: string) => {
    // 模拟登录完成（测试用）
    setClients((prev) => prev.map((c) => (c.id === clientId ? { ...c, authStatus: 'ready' as const } : c)));
    setSelected((prev) => new Set(prev).add(clientId));
  }, []);

  const canContinue =
    selected.size > 0 && Array.from(selected).every((id) => clients.find((c) => c.id === id)?.authStatus === 'ready');

  const handleContinue = useCallback(() => {
    if (!canContinue) return;
    const selectedClients = clients
      .filter((c) => selected.has(c.id))
      .map((c) => ({ name: c.name, id: c.id, provider: c.provider }));
    onComplete(selectedClients);
  }, [canContinue, clients, selected, onComplete]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>看懂一次协作，再得到自己的伙伴</h1>
        <span className={styles.mockBadge}>演示数据 · 不调用真实模型</span>
      </div>

      <div className={styles.scene}>
        <h2>6. 检测本机 client</h2>
        <p className={styles.lead}>客户端清单和登录门禁是状态机；"去登录"不会直接算成功。</p>

        {clients.length === 0 && !loading && (
          <div className={styles.notice}>
            此处真实产品接入 client 探测与各 CLI 自己的登录流程。
            {error && <div className={styles.error}>{error}</div>}
          </div>
        )}

        <div className={styles.stage}>
          {loading ? (
            <div className={styles.loading}>正在探测本机 CLI...</div>
          ) : clients.length === 0 ? (
            <div className={styles.noClients}>
              <p>未检测到 client。请先安装并登录一个支持的 client，完成后点击"重新检测"。</p>
              <div className={styles.installLinks}>
                <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer">
                  安装 Claude Code
                </a>
                <a href="https://openai.com/codex" target="_blank" rel="noopener noreferrer">
                  安装 Codex
                </a>
              </div>
            </div>
          ) : (
            <div className={styles.clients}>
              {clients.map((client) => (
                <div
                  key={client.id}
                  className={`${styles.client} ${client.authStatus === 'ready' ? styles.ready : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(client.id)}
                    disabled={client.authStatus !== 'ready'}
                    onChange={() => handleToggle(client.id, client.authStatus)}
                  />
                  <div className={styles.clientInfo}>
                    <strong>{client.name}</strong>
                    <small>
                      {client.authStatus === 'ready' && '已登录，可绑定成员'}
                      {client.authStatus === 'pending' && '等待 CLI 登录完成'}
                      {client.authStatus === 'login_required' && '需要先完成该 CLI 自己的登录'}
                      {client.authStatus === 'not_installed' && '未安装'}
                    </small>
                  </div>
                  <span
                    className={`${styles.state} ${
                      client.authStatus === 'ready' ? styles.stateOk : styles.statePending
                    }`}
                  >
                    {client.authStatus === 'ready' && '可用'}
                    {client.authStatus === 'pending' && '等待登录'}
                    {client.authStatus === 'login_required' && '未登录'}
                    {client.authStatus === 'not_installed' && '未安装'}
                  </span>
                  {client.authStatus === 'login_required' && (
                    <button type="button" onClick={() => handleLogin(client.id)} className={styles.loginButton}>
                      去登录
                    </button>
                  )}
                  {client.authStatus === 'pending' && (
                    <button
                      type="button"
                      onClick={() => handleSimulateLoginComplete(client.id)}
                      className={styles.loginButton}
                    >
                      模拟 CLI 登录完成
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className={styles.actions}>
          <button type="button" onClick={detectClients} className={styles.button} disabled={loading}>
            重新检测
          </button>
          <button type="button" onClick={handleContinue} className={styles.primaryButton} disabled={!canContinue}>
            确认并进入交接
          </button>
        </div>
      </div>
    </div>
  );
}
