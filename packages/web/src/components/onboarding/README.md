# 首启旅程组件实现

> Issue #1466 的 Phase 1 实现（核心流程 MVP）

## 实现的组件

### 主容器
- `OnboardingJourney.tsx` - 主流程容器，管理场景切换和状态

### 场景组件
1. **DemoScenes.tsx** (场景 1-5)
   - 场景 1: 三只猫先出现
   - 场景 2: 输入框自动打字（30ms/字符，支持暂停）
   - 场景 3: 一只猫接住消息并 @ 同伴
   - 场景 4: 因为协作，结果变好了（删除线/高亮展示改动）
   - 场景 5: 解说收束

2. **ClientSetup.tsx** (场景 6)
   - 真实调用 `/api/clients/detect` 探测本机 CLI
   - 支持 0/1/多 client 分支
   - 登录门禁：pending 状态必须完成才能选择
   - 模拟登录完成按钮（测试用）

3. **MemberHandoff.tsx** (场景 7)
   - 调用 `/api/members/batch` 批量创建成员
   - 明确区分示范团队和真实团队
   - 交接文案根据成员数量动态调整

4. **RealChatEntry.tsx** (场景 8)
   - 用户可自由输入
   - 入口提醒非阻塞，可关闭
   - 发送第一句话后进入真实聊天界面

### 状态管理
- `onboarding-state.ts` - 状态机设计，localStorage 持久化
- 支持刷新恢复（不重放已完成示范）

### 样式
- 所有组件使用 CSS Modules
- 响应式布局（桌面 + 移动端）
- 复用原型的配色和布局

## 与技术方案的对应

| 技术方案要求 | 实现状态 | 说明 |
|------------|---------|------|
| 场景 1-5 脚本演示 | ✅ | 完整实现，使用简化动画（字母头像） |
| 场景 6 真实 client 探测 | ✅ | 调用 `/api/clients/detect` |
| 场景 7 成员创建与交接 | ✅ | 调用 `/api/members/batch` |
| 场景 8 进入真实聊天 | ✅ | 发送第一句话后调用 onComplete |
| 状态持久化 | ⚠️ | 当前使用 localStorage，生产需改为 Redis |
| 刷新恢复机制 | ✅ | 完整实现 |

## 未实现的部分（Phase 2/3）

- [ ] character-canon sprite sheets（当前使用字母头像占位）
- [ ] 猫的跑步循环动画（当前使用 CSS transform 模拟）
- [ ] "猫→头像"形变动画
- [ ] 0 client 分支的完整安装指引
- [ ] pending 登录状态的真实 CLI 拉起和轮询
- [ ] 可选训练路径（阶段 8-12）

## 使用方式

```tsx
import { OnboardingJourney } from '@/components/onboarding/OnboardingJourney';

function App() {
  const handleComplete = (members) => {
    console.log('首启完成，成员:', members);
    // 进入真实聊天界面
  };

  return <OnboardingJourney onComplete={handleComplete} />;
}
```

## 测试

```bash
# 单元测试
pnpm --filter @cat-cafe/web test onboarding-state.test.ts

# E2E 测试（TODO）
# pnpm --filter @cat-cafe/web test:e2e onboarding-journey.test.tsx
```

## 下一步

1. 集成到 App.tsx（首启时渲染）
2. 实现后端 API：
   - `GET /api/clients/detect` - client 探测
   - `POST /api/members/batch` - 批量创建成员
3. E2E 测试覆盖
4. 视觉打磨（Phase 2）
