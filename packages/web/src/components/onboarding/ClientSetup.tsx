'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';
import styles from './ClientSetup.module.css';

interface DetectedClient {
	name: string;
	id: string;
	provider: string;
	installed: boolean;
	authStatus: 'ready' | 'login_required' | 'not_installed';
}

interface ClientSetupProps {
	onComplete: (clients: Array<{ name: string; id: string; provider: string }>) => void;
}

/**
 * 场景 6: 检测本机 client
 * 使用真实 API: GET /api/first-run/available-clients
 * 部署边界：仅桌面应用支持（本地 API 探测本地环境）
 */
export function ClientSetup({ onComplete }: ClientSetupProps) {
	const [clients, setClients] = useState<DetectedClient[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	// 探测本机 client（调用真实 API）
	const detectClients = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await apiFetch<{
				clients: Array<{
					name: string;
					cliTool: string;
					installed: boolean;
					authenticated: boolean;
					version?: string;
				}>;
			}>('/api/first-run/available-clients');

			// 转换为组件所需格式
			const converted: DetectedClient[] = response.clients.map((c) => ({
				name: c.name,
				id: c.cliTool,
				provider: c.cliTool,
				installed: c.installed,
				authStatus: c.authenticated ? 'ready' : c.installed ? 'login_required' : 'not_installed',
			}));

			setClients(converted);

			// 自动选择已认证的 client
			const autoSelected = new Set(converted.filter((c) => c.authStatus === 'ready').map((c) => c.id));
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
		if (authStatus !== 'ready') return; // 只能选择已认证的
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

	const canContinue =
		selected.size > 0 && Array.from(selected).every((id) => clients.find((c) => c.id === id)?.authStatus === 'ready');

	const handleContinue = useCallback(() => {
		if (!canContinue) return;
		const selectedClients = clients.filter((c) => selected.has(c.id)).map((c) => ({ name: c.name, id: c.id, provider: c.provider }));
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
				<p className={styles.lead}>探测本地安装并已认证的 CLI。未认证的显示文本提示。</p>

				{clients.length === 0 && !loading && (
					<div className={styles.notice}>
						此功能仅在桌面应用中可用。远程 Web 应用无法探测您电脑上的 CLI。
						{error && <div className={styles.error}>{error}</div>}
					</div>
				)}

				<div className={styles.stage}>
					{loading ? (
						<div className={styles.loading}>正在探测本机 CLI...</div>
					) : clients.length === 0 ? (
						<div className={styles.noClients}>
							<p>未检测到已安装的 client。请先安装并认证一个支持的 CLI，完成后点击"重新检测"。</p>
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
								<div key={client.id} className={`${styles.client} ${client.authStatus === 'ready' ? styles.ready : ''}`}>
									<input
										type="checkbox"
										checked={selected.has(client.id)}
										disabled={client.authStatus !== 'ready'}
										onChange={() => handleToggle(client.id, client.authStatus)}
									/>
									<div className={styles.clientInfo}>
										<strong>{client.name}</strong>
										<small>
											{client.authStatus === 'ready' && '已认证，可绑定成员'}
											{client.authStatus === 'login_required' && `需要先在终端运行: ${client.id} auth login`}
											{client.authStatus === 'not_installed' && '未安装'}
										</small>
									</div>
									<span className={`${styles.state} ${client.authStatus === 'ready' ? styles.stateOk : styles.statePending}`}>
										{client.authStatus === 'ready' && '可用'}
										{client.authStatus === 'login_required' && '未认证'}
										{client.authStatus === 'not_installed' && '未安装'}
									</span>
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
