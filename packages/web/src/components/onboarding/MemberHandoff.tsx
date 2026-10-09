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
const CAT_CONFIGS = [
	{
		breedId: 'ragdoll',
		name: '布偶猫',
		displayName: '布偶猫',
		color: { primary: '#e8a983', secondary: '#f5d4c1' },
		roleDescription: '深度架构与系统设计',
		personality: '谨慎思考，追求优雅方案',
		teamStrengths: '复杂系统建模、技术方案设计',
		mentionPatterns: ['@ragdoll', '@布偶猫'],
	},
	{
		breedId: 'maine-coon',
		name: '缅因猫',
		displayName: '缅因猫',
		color: { primary: '#8d9aab', secondary: '#c5cdd6' },
		roleDescription: '代码审查与质量把关',
		personality: '严谨细致，注重可维护性',
		teamStrengths: '代码 review、测试覆盖、重构建议',
		mentionPatterns: ['@maine-coon', '@缅因猫'],
	},
	{
		breedId: 'siamese',
		name: '暹罗猫',
		displayName: '暹罗猫',
		color: { primary: '#d7ba85', secondary: '#ebe0c8' },
		roleDescription: '用户体验与产品思考',
		personality: '敏锐洞察，关注体验细节',
		teamStrengths: 'UX 设计、产品打磨、文案优化',
		mentionPatterns: ['@siamese', '@暹罗猫'],
	},
];

/**
 * 场景 7: 从示范团队交接到我的伙伴
 * 使用真实 API: POST /api/cats（循环创建，每个 client 一次调用）
 * 符合 cats.ts 的完整 schema，处理部分失败
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
				const catConfig = CAT_CONFIGS[index % CAT_CONFIGS.length];
				const catId = `${catConfig.breedId}-${client.id}`;

				try {
					await apiFetch('/api/cats', {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'X-Cat-Cafe-User': 'default-user', // 使用默认用户
						},
						body: JSON.stringify({
							catId,
							breedId: catConfig.breedId,
							name: catConfig.name,
							displayName: catConfig.displayName,
							color: catConfig.color,
							mentionPatterns: catConfig.mentionPatterns,
							roleDescription: catConfig.roleDescription,
							personality: catConfig.personality,
							teamStrengths: catConfig.teamStrengths,
							clientId: client.id,
							provider: client.provider,
							defaultModel: '', // 空字符串表示使用 CLI 默认模型
							mcpSupport: false,
							// accountRef 和 cli 字段是可选的，后端会使用默认值
						}),
					});

					createdMembers.push({ client: client.name, cat: catConfig.breedId });
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
		breed: CAT_CONFIGS[index % CAT_CONFIGS.length].breedId,
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
