# Issue #1657 验收证据

**最终SHA**: 待更新（P1修复后）  
**验收日期**: 2026-10-21  
**验收方式**: 自动化测试（单元测试级别，非真实浏览器）

---

## 验收限制说明

**原计划**：浏览器交互式验收  
**实际执行**：自动化单元测试覆盖  
**原因**：Hub客户端不在前台

**单元测试覆盖范围**：
- ✅ Hook逻辑正确性（owner隔离/CAS/revision推进）
- ✅ API契约正确性（请求格式/响应处理）
- ✅ 状态管理正确性（草稿恢复/conflict处理）

**未覆盖范围**：
- ⚠️ 真实浏览器渲染和React提交时序
- ⚠️ 真实用户交互流程
- ⚠️ CSS/layout/UI呈现

**风险**：单元测试无法验证React状态更新的真实时序，可能遗漏时序相关的bug。

---

## 测试场景映射

审核要求的4个场景通过73个单元测试部分覆盖（逻辑层面，非UI层面）：

### 1. 新对话入口（Draft Persistence Tests）

**测试覆盖**：
- ✅ `restores draft when remounting with same threadId` (15ms)
- ✅ `maintains independent drafts per thread` (16ms)
- ✅ `does not persist draft when threadId is undefined` (8ms)
- ✅ `syncs text drafts to sessionStorage for cross-navigation survival` (6ms)

**验证内容**：
- 新对话创建时草稿正确初始化
- threadId正确绑定
- 多对话独立草稿隔离

---

### 2. 恢复确认（Recovery & Conflict Tests）

**测试覆盖**：
- ✅ `still requires confirmation and displays both drafts when hydration arrives after the click` (8ms)
- ✅ `requires confirmation before a retry can overwrite an unseen draft fetched after a 409` (7ms)
- ✅ `preserves typing done while the merged recovery snapshot is being saved` (7ms)
- ✅ `restores the confirmed attempted edit when its confirming retry meets another 409` (7ms)
- ✅ `hydrates the TTL=0 server draft on F5 and preserves a newer local session draft` (7ms)
- ✅ `hydrates the newer authoritative draft when admission clear loses a revision race` (8ms)

**验证内容**：
- 409冲突时展示恢复确认UI
- 用户确认后正确合并草稿
- 保存期间的新输入不丢失
- 服务端draft优先于本地session draft

---

### 3. 删除图片/引用/回复（Deletion & Context Tests）

**测试覆盖**：

**图片删除**：
- ✅ `keeps local File attachments when a save is rejected` (9ms)
- ✅ `restores image preview when remounting with same threadId` (14ms)
- ✅ `maintains independent image previews per thread across switches` (20ms)
- ✅ `sends restored images and clears image drafts after sending` (16ms)
- ✅ `keeps queued image-discard persistence and its failure rollback inside the original owner` (5ms)

**引用删除**：
- ✅ `flushes file-side deletion on page exit without waiting for the typing debounce` (39ms)
- ✅ `captures a file-side deletion when pagehide precedes the composer React commit` (8ms)

**回复删除**：
- ✅ `preserves context and reply selected while the merged recovery snapshot is being saved` (8ms)
- ✅ `restores and sends structured context attachments without Markdown text` (16ms)
- ✅ `keeps structured context drafts when the send is rejected before admission` (9ms)

**验证内容**：
- 删除图片后草稿正确保存
- 删除引用/回复后不丢失其他内容
- 跨owner删除不污染新owner状态
- pagehide捕获删除操作

---

### 4. 切换Thread（Thread Switch & Owner Isolation Tests）

**测试覆盖**：

**基础切换**：
- ✅ `restores the original draft selection after visiting another thread without moving focus` (91ms)
- ✅ `shares one live text draft across two composers for the same thread` (17ms)
- ✅ `maintains independent drafts per thread` (16ms)

**Owner隔离（核心修复）**：
- ✅ `does not restore an old-thread admission into the newly selected thread` (5ms)
- ✅ `does not let autosave overwrite an unseen draft after a 409` (4ms)
- ✅ `does not let pagehide overwrite an unseen draft after a 409` (4ms)
- ✅ `keeps autosaving the new thread after the old-thread admission finishes` (7ms)
- ✅ `keeps an old-thread queued pagehide save from adopting the new thread generation and revision` (6ms)
- ✅ `keeps an old-thread queued ordinary flush save from adopting the new thread generation and revision` (4ms)
- ✅ `advances CAS within one owner when a second autosave is queued behind its own slow first save` (6ms)
- ✅ `restores a rejected send and releases autosave after a same-thread pending insert changes hydration generation` (5ms)
- ✅ `keeps queued image-discard persistence and its failure rollback inside the original owner` (5ms)

**验证内容**：
- 切换thread后草稿正确恢复
- 旧thread排队保存不污染新thread
- 同owner CAS正确推进
- 引用更新不破坏owner身份

---

## 测试执行结果

```
Test Files  3 passed (3)
Tests       73 passed (73)
Duration    ~6.5s

Files:
- chat-input-draft-admission-regressions.test.tsx: 20/20 passed
- chat-input-draft-persistence.test.ts: 42/42 passed  
- durable-composer-draft-page-exit.test.tsx: 11/11 passed
```

**测试级别**：单元测试（jsdom环境，非真实浏览器）  
**HTTP层**：Stub（内存mock，非真实网络）

---

## 修复覆盖范围

**Owner隔离修复（R6-R9）**：
1. ✅ Autosave入口绑定owner
2. ✅ Pagehide入口绑定owner
3. ✅ Ordinary flusher绑定owner
4. ✅ Admission cleanup使用稳定ownerId
5. ✅ 图片保存绑定owner
6. ✅ 图片失败回滚验证owner

**关键设计原则**：
- Owner身份（ownerId+threadId）稳定，只在threadId切换时变化
- Revision动态推进，执行时读取revisionRef.current
- hydrationGeneration取消hydration，不代表owner身份
- 所有enqueue入口在调用时捕获owner
- 所有async操作在await后验证owner

---

## 已知限制

**单元测试无法验证的场景**：
1. ⚠️ **迟到hydration确认** - React状态更新时序可能导致确认逻辑失效
2. ⚠️ 真实浏览器事件处理
3. ⚠️ 真实网络请求时序
4. ⚠️ UI渲染和用户交互

**需要真实浏览器验证**：新对话迟到hydration场景

---

## 提交记录

```
c6c19d8fb - fix: R9 image save owner binding and failure rollback isolation
fce004347 - test: add 5 owner isolation regression tests to repository
18825a838 - docs: acceptance verification via automated test coverage
```

**当前交付SHA**: `fce004347`（代码修复）

---

## 验收结论

**通过73个单元测试的逻辑验证**（非完整浏览器验收）：

核心修复（owner隔离）在单元测试级别验证生效：
- ✅ 跨thread切换不污染（单元测试）
- ✅ 同owner CAS正确推进（单元测试）
- ✅ 引用更新不破坏owner（单元测试）
- ✅ 图片操作隔离正确（单元测试）

**未验证**：真实浏览器React时序相关场景

[宪宪/Claude Opus🐾]
