'use client';

import { useCallback, useState } from 'react';
import { apiFetch } from '@/utils/api-client';
import styles from './MemberHandoff.module.css';

interface MemberHandoffProps {
	selectedClients: Array<{ name: string; id: string; provider: string }>;
	onComplete: (members: Array<{ client: string; cat: string }>) => void;
}

// 使用固定的猫品种映射（Phase 1 简化方案）
// TODO Phase 2: 从 catRegistry 读取可用品种
const CAT_BREEDS = ['ragdoll', 'maine-coon', 'siamese'];

/**
 * 场景 7: 从示范团队交接到我的伙伴
 * 使用真实 API: POST /api/cats（循环创建，每个 client 一次调用）
 * 处理部分失败：记录已创建的成员 ID
 */
export function MemberHandoff({ selectedClients, onComplete }: MemberHandoffProps) {
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [createdCount, setCreatedCount] = useState(0);

	const handleContinue = useCallback(async () => {
		setCreating(true);
		setError(null);
		setCreatedCount(0);

		const createdMembers: Array<{ client: string; cat: string }> = [];

		try {
			// 循环调用 POST /api/cats 创建每个成员
			for (const [index, client] of selectedClients.entries()) {
				const breedId = CAT_BREEDS[index % CAT_BREEDS.length];
				const catName = `${breedId}-${client.id}`;

				try {
					await apiFetch('/api/cats', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							breedId,
							name: catName,
							displayName: `${breedId.charAt(0).toUpperCase() + breedId.slice(1).replace(/-/g, ' ')}`,
							clientId: client.id,
							provider: client.provider,
							// 使用默认配置，后端会填充其他必需字段
						}),
					});

					createdMembers.push({ client: client.name, cat: breedId });
					setCreatedCount((prev) => prev + 1);
				} catch (err) {
					// 部分失败：记录已创建的成员，抛出错误
					const errorMsg = err instanceof Error ? err.message : '未知错误';
					throw new Error(
						`创建成员失败：${client.name}（${errorMsg}）。已创建 ${createdMembers.length}/${selectedClients.length} 个成员。`
					);
				}
			}

			// 全部创建成功
			onComplete(createdMembers);
		} catch (err) {
			setError(err instanceof Error ? err.message : '成员创建失败');
			setCreating(false);
		}
	}, [selectedClients, onComplete]);

	const members = selectedClients.map((client, index) => ({
		client: client.name,
		breed: CAT_BREEDS[index % CAT_BREEDS.length],
	}));

	const handoffText =
		members.length === 1
			? '先从你和它开始，之后可以再邀请更多伙伴。'
			: `已按你的选择配置 ${members.length} 位真实伙伴。未选择的演示猫不会出现在成员列表。`;

	const memberList = members.map((m) => `${m.breed}猫（${m.client}）`).join('、');

	const progressText = creating ? `正在创建成员... (${createdCount}/${selectedClients.length})` : '进入真实主界面';

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
							<b>{memberList} 将加入你的团队</b>
							<p>{handoffText}</p>
							<p className={styles.boundary}>刚才是示范，从这里开始，就是与你自己的猫交流了。</p>
						</div>
					</div>

					{error && <div className={styles.error}>{error}</div>}
				</div>

				<div className={styles.actions}>
					<button type="button" onClick={handleContinue} className={styles.primaryButton} disabled={creating}>
						{progressText}
					</button>
				</div>
			</div>
		</div>
	);
}
