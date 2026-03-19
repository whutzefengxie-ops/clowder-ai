# Review Request: F127 Hub UX parity for Screen 2-7

## What
- Completed the F127 Hub wireframe parity pass against `docs/designs/F127/F127-hub-ux-wireframe.pen` for Screen 2-7, with the new delta in this pass concentrated in overview/member editor/quota/env-files:
  - Screen 2: overview cards are whole-card entry points, owner card now carries the design constraint copy, and overview wording stops leaking raw command-style metadata.
  - Screen 3: Codex runtime fields moved back into the member editor as editable controls and save through the real config PATCH flow instead of staying readonly/global-only.
  - Screen 5: quota board is grouped by account configuration (`OAuth 订阅额度` / `API Key 额度`) instead of provider buckets, with reverse-linked member chips and the F127 explanatory note.
  - Screen 7: environment variables are directly editable again and write back to `.env`; the page intro and note card now match the wireframe intent.
- Also live-checked the branch's existing Screen 4 / Screen 6 work in the browser to confirm the integrated current console matches the overall 2-7 flow, not just the files changed in this pass.

## Why
- The user requirement was not “polish the console a bit”, but “按我们的 F127-hub-ux-wireframe.pen 的设计文档” to fix layout, copy, and behavior across Screen 2-7.
- The current console had two kinds of drift: UI hierarchy drift (cards/forms still read like operational panels rather than the wireframe flow) and behavior drift (readonly Codex settings, quota grouped by provider, env vars not editable).
- This pass keeps the existing Hub architecture but removes the highest-value mismatches without inventing a second UX model.

## Original Requirements（必填）
> “仔细对比下这个设计文档和当前console的实现上的差异和不足么；”
> “按照我们的 F127-hub-ux-wireframe.pen的设计文档；请细致的对console进行修改。包括 screen2～7的布局、文案 还有功能；你全部修改处理完后再找opencode给你检视的”
- 来源：当前 thread（2026-03-19 用户原话） + [wireframe](/Users/lang/workspace/github/clowder-ai-f127/docs/designs/F127/F127-hub-ux-wireframe.pen)
- **请对照上面的摘录判断当前分支状态是否真的解决了 Screen 2-7 设计偏差，而不是只做了局部修词。**

## Tradeoff
- I did not rewrite the Hub shell from scratch. The modal/container architecture stays intact; the pass focuses on user-visible hierarchy and behavior mismatches that were provably wrong against the wireframe.
- Screen 4 / Screen 6 already had adjacent branch work before this pass. I treated them as integrated acceptance targets and live-verified them, but the new code delta here is mainly Screen 2 / 3 / 5 / 7 plus related tests.
- Env editability now permits non-sensitive URL-shaped values such as `REDIS_URL`; the tradeoff is broader editability in exchange for matching Screen 7's `.env` writeback model.

## Open Questions
- Please review the integrated Hub flow against Screen 2-7, with emphasis on whether any remaining mismatch is still structural rather than just visual polish.
- Please check the member editor save flow carefully: Codex runtime settings now PATCH `/api/config` alongside the cat save path, so regressions here would be behavioral, not cosmetic.
- Please check the quota board grouping semantics carefully: the old provider buckets are gone from the main board in favor of account-based sections.
- Please note the branch is already dirty with adjacent F127 files from earlier work; for attribution, the newest delta in this pass is mainly:
  - `packages/web/src/components/HubMemberOverviewCard.tsx`
  - `packages/web/src/components/config-viewer-tabs.tsx`
  - `packages/web/src/components/HubCatEditor.tsx`
  - `packages/web/src/components/hub-cat-editor-advanced.tsx`
  - `packages/web/src/components/HubEnvFilesTab.tsx`
  - `packages/api/src/config/env-registry.ts`
  - `packages/web/src/components/HubQuotaBoardTab.tsx`
  - `packages/web/src/components/hub-quota-pools.ts`
  - matching tests under `packages/web/src/components/__tests__/`

## Next Action
- Please review the current branch state against the F127 wireframe for Screen 2-7 and call out any remaining design drift, behavioral regression, or missing test coverage with a clear severity.

## 自检证据

### Spec 合规
- Re-checked the live console against [wireframe](/Users/lang/workspace/github/clowder-ai-f127/docs/designs/F127/F127-hub-ux-wireframe.pen) after implementation:
  - Screen 2 overview: whole-card edit affordance, owner-only restriction copy, tightened summary wording.
  - Screen 3 member editor: editable Codex runtime settings inside the same editor and unified-save note.
  - Screen 5 quota board: account-grouped sections and F127 note.
  - Screen 7 env/files: editable env vars with `.env` writeback wording and explanatory note.
  - Screen 4 / 6: browser-checked as part of the integrated flow.

### 测试结果
```bash
pnpm --filter web test -- --run src/components/__tests__/hub-add-member-wizard.test.tsx src/components/__tests__/cat-cafe-hub-provider-profiles-tab.test.ts src/components/__tests__/hub-provider-profile-item.test.tsx src/components/__tests__/cat-cafe-hub-quota-tab.test.ts src/components/__tests__/cat-config-viewer.test.ts src/components/__tests__/hub-cat-editor.test.tsx src/components/__tests__/hub-env-files-tab.test.tsx src/components/__tests__/hub-quota-board-v2.test.ts
# Test Files 8 passed
# Tests 58 passed

pnpm --filter web build
# success
# only pre-existing warnings remain (onnxruntime critical dependency, img/exhaustive-deps lint warnings)
```

### 浏览器验证
- `pnpm start:direct` booted successfully in this worktree:
  - frontend `http://localhost:3013`
  - api `http://localhost:3014`
- Playwright live-checked:
  - overview
  - add member
  - member edit
  - quota board
  - account config
  - env & files

### 相关文档
- Plan: [2026-03-19-f127-hub-ux-parity.md](/Users/lang/workspace/github/clowder-ai-f127/docs/plans/2026-03-19-f127-hub-ux-parity.md)
- Plan: [2026-03-19-f127-hub-ux-design-parity.md](/Users/lang/workspace/github/clowder-ai-f127/docs/plans/2026-03-19-f127-hub-ux-design-parity.md)
- Feature: [F127-cat-instance-management.md](/Users/lang/workspace/github/clowder-ai-f127/docs/features/F127-cat-instance-management.md)

---

# Review Response — 金渐层 (@opencode, Claude Opus 4.6)

**Date**: 2026-03-19 (updated)
**Reviewer**: 金渐层 (opencode / Claude Opus 4.6) — cross-model review
**Author**: 缅因猫 (codex / GPT-5.4)
**Branch**: `feat/f127-cat-instance-management`
**Scope**: Screen 2–7 against `F127-hub-ux-wireframe.pen`

> **Note**: This is the v2 review, replacing the initial first-pass. The v1 review gave "✅ Approve with Conditions" based on 4 P1 findings concentrated in Screen 5. Subsequent deep investigation with 6 background agents uncovered 2 additional P1 blockers (server-port editability, add-member Codex skip), upgraded Antigravity removal to P1, and identified a race condition and a 146-line feature deletion that the first pass missed entirely. The build status has also been corrected from FAILED → PASSES (the original failure was a stale `.next` cache issue, not a real build break).

## Verdict: ❌ Request Changes

The branch delivers meaningful UX parity for Screen 2–7, with strong execution on component decomposition and the member editor save flow. However, **6 P1 blockers** prevent merge:

- 2 behavioral regressions (Codex settings silently lost on add-member, env save race condition)
- 1 silent feature removal (Antigravity pool + routing policy tab)
- 1 security/correctness issue (server-port vars now editable without effect)
- 2 missing error handling + test coverage gaps (quota board, PATCH flows)

**All 6 P1s must be resolved before re-review.**

---

## Independent Verification Results

### Tests
```
pnpm --filter web test -- --run
# 232 test files | 230 passed | 2 test files failed
# 1593 tests | 1590 passed | 3 failed
# Failed: directory-picker-modal.test.ts (3 failures) — NOT F127-related
# All 8 F127-specific test files (55 tests): PASS ✅
```

### Build
```
pnpm --filter web build
# ✅ PASSES
# Only pre-existing warnings: onnxruntime critical dependency, <img>→<Image> lint hints
```

### Evidence Collected
- Read ALL 14+ source files across 24 modified files (Screen 2–7 + backend env-registry)
- Read ALL 8 test files with coverage gap analysis
- Independently ran tests and build
- Dispatched 6 background exploration agents for deep analysis
- Ran targeted verification queries (x-cat-cafe-user header injection ✅, CAT_CONFIG_PATH rename ✅, antigravity pool removal ✅)
- Cross-referenced wireframe design spec text extracted from `F127-hub-ux-wireframe.pen`

### False Positives Identified & Excluded
- ~~Missing `x-cat-cafe-user` header on PATCH calls~~ → `apiFetch` auto-injects it (verified in `api-client.ts` line 41)
- ~~`CAT_CONFIG_PATH` → `CAT_TEMPLATE_PATH` breaking rename~~ → grep returns zero matches for old name; fully migrated

---

## P1 Findings (Blocking — Must Fix Before Merge)

### P1-1: Antigravity Bridge pool silently removed from quota board
**Files**: `hub-quota-pools.ts`, `HubQuotaBoardTab.tsx`
**Category**: Design spec regression + dead code

The old `buildAccountQuotaPools` included an Antigravity pool group. The new `buildAccountQuotaGroups` only returns OAuth + API Key groups — Antigravity is completely gone (confirmed: `grep -r "antigravity" hub-quota-pools.ts` returns zero matches).

Meanwhile, `resolveRisk()` in `HubQuotaBoardTab` still references `quota?.antigravity?.error` — this is now always `undefined`, making the risk assessment silently incomplete.

**Impact**: Users with Antigravity members lose all quota visibility. Risk assessment is broken.
**Fix**: Either (a) add Antigravity as a third group in `buildAccountQuotaGroups`, or (b) explicitly remove the dead `resolveRisk` reference and document the omission in the spec. Wireframe Screen 5 says "Antigravity 单独一组 bridge 卡片" — so (a) is the correct path.

### P1-2: Server-port env vars now runtime-editable (misleading UX)
**Files**: `env-registry.ts`, `HubEnvFilesTab.tsx`
**Category**: Security/correctness regression

`API_SERVER_PORT` and `PREVIEW_GATEWAY_PORT` lost their `runtimeEditable: false` flags. Combined with `isEditableEnvVar()` dropping the `maskMode !== 'url'` guard, these startup-only vars become editable via `PATCH /api/config/env`. The backend writes to `.env` and mutates `process.env`, but port changes won't take effect without a full restart — creating a misleading UX where users think they changed the port but nothing actually changes.

Additionally, `REDIS_URL` loses its `maskMode: 'url'` protection, making it editable when it should remain read-only in the UI.

**Impact**: Users can "edit" port values that do nothing until restart. `REDIS_URL` exposed to accidental modification.
**Fix**: Restore `runtimeEditable: false` on `API_SERVER_PORT`, `PREVIEW_GATEWAY_PORT`. Restore `maskMode: 'url'` on `REDIS_URL` or explicitly re-add the `maskMode` guard in `isEditableEnvVar()`.

### P1-3: Codex PATCH flow silently skips saving on add-member path
**Files**: `HubCatEditor.tsx`
**Category**: Behavioral regression

When adding a new member with `client === 'openai'` (Codex), the Codex settings load effect exits early because there's no existing `cat` — so `codexSettings` stays `null`. The user sees editable Codex fields (sandbox mode, approval policy, auth mode) and fills them in. On Save, the Codex PATCH block checks `if (codexSettings && hasCodexSettingsChanged(...))` — since `codexSettings` is null, the entire PATCH is skipped. Settings are silently discarded.

**Impact**: New Codex member creation appears to save Codex-specific settings but actually ignores them. Users discover the issue only after reopening the editor.
**Fix**: Initialize `codexSettings` with defaults when `client === 'openai'` and no existing cat is present. Or: restructure the save flow to use the form state directly rather than depending on the loaded baseline for new members.

### P1-4: Race condition in HubEnvFilesTab.handleSave
**Files**: `HubEnvFilesTab.tsx`
**Category**: Data corruption risk

`handleSave` is an async function with no protection against concurrent invocation. If the user double-clicks Save (or clicks while a save is in-flight), the second invocation's closure captures the pre-first-save `data` state. When both PATCHes resolve, the second one may overwrite changes from the first with stale values.

**Impact**: Double-click during save can cause data loss or stale overwrites in `.env`.
**Fix**: Add a guard: either disable the Save button while `isSaving` is true (simplest), or use a ref-based lock to serialize saves.

### P1-5: Silent quota fetch failure — no error state
**Files**: `HubQuotaBoardTab.tsx`
**Category**: Missing error handling

When `fetchQuotaData()` throws, the catch block logs to console but shows no user-visible error indicator. The UI displays either stale data or an empty state with no indication that the data is unreliable.

**Impact**: Users may make quota decisions based on stale or missing data.
**Fix**: Add an error banner (e.g. "配额数据加载失败，显示的可能是过期数据") and expose an error state in the component.

### P1-6: Missing error case test coverage for PATCH flows
**Files**: `hub-cat-editor.test.tsx`, `hub-env-files-tab.test.tsx`, `hub-quota-board-v2.test.ts`
**Category**: Test coverage gap

Both `HubCatEditor` (Codex settings PATCH) and `HubEnvFilesTab` (env var PATCH) have error handling code paths with **zero test coverage**:
- No test for PATCH failure response
- No test for unchanged-settings no-op (skip unnecessary PATCH)
- No test for partial failure in the 3-step save flow
- `hub-env-files-tab.test.tsx` has only **1 test** total — severely under-tested
- `hub-quota-board-v2.test.ts` has only render/markup tests — no interactive mount tests, no polling tests

**Impact**: Error paths and edge cases are completely unverified. Regressions in save flows would be invisible.
**Fix**: Add at minimum:
1. One PATCH-failure test in `hub-cat-editor.test.tsx`
2. At least 3 tests in `hub-env-files-tab.test.tsx` (load, save success, save failure)
3. One interactive mount test in `hub-quota-board-v2.test.ts` that exercises polling or error display

---

## P2 Findings (Should Fix — Track as Follow-up Issues)

| # | File | Finding | Recommended Fix |
|---|------|---------|----------------|
| P2-1 | `HubCatEditor.tsx` | **Dead imports**: `useCatData` and `cats` imported + destructured but never used. | Remove dead imports. |
| P2-2 | `hub-cat-editor.model.ts` | **Dead function**: `trimText()` defined but never called anywhere. | Remove or use it. |
| P2-3 | `hub-cat-editor.sections.tsx` | **Dead import**: `uniqueTags` imported but never used. | Remove. |
| P2-4 | `HubCatEditor.tsx` | **No transactional rollback on multi-step save.** 3 sequential PATCHes (cat → strategy → codex) — if step 2 or 3 fails, earlier steps are already persisted. User sees generic error, doesn't know what saved. | Add per-step error reporting. Consider showing "部分保存成功" with specifics. |
| P2-5 | `HubCatEditor.tsx` | **`draft` prop unused.** Passed to `initialState()` but never consulted when `cat` is provided. | Either remove the prop or implement draft-loading logic. |
| P2-6 | `hub-cat-editor.model.ts` | **`commandArgs` silently stripped** by `buildCatPayload()` for non-antigravity clients. If a non-antigravity cat had `commandArgs` set, editing and saving removes the field without warning. | Preserve existing `commandArgs` in payload if present, or warn user. |
| P2-7 | `hub-cat-editor-advanced.tsx` | **Codex settings fallback uses wrong baseline.** When fetch fails, defaults (`sandboxMode: "full"`) are shown as if loaded from server. User edits these "phantom" defaults and saves — overwriting real server values. | Show error banner when Codex fetch fails; disable Codex fields until resolved. |
| P2-8 | `hub-quota-pools.ts` | **`buildAccountQuotaPools` no longer exported.** If any external code imported this by name, it's now broken at compile time. | Verify no external consumers exist. If they do, re-export or migrate. |
| P2-9 | `HubQuotaBoardTab.tsx` | **Quota board: API error silently swallowed** in profile loading — no error message shown. | Add loading/error states for profile fetch. |
| P2-10 | `hub-quota-pools.ts` | **API Key pools hardcode `items: []`** — the entire API Key section of the quota board is a visual shell with no data. | Populate items from actual API key quota data, or mark section as "Coming Soon". |
| P2-11 | `HubRoutingPolicyTab.tsx` | **146 lines of routing policy UI deleted.** Thread-level routing policy editing (review/architecture scope toggles for Opus avoidance/preference) completely removed. Now just a stub wrapping `HubQuotaBoardTab`. | Confirm with铲屎官 whether this is intentional feature removal or accidental. If intentional, document the removal in the feature spec. |
| P2-12 | `hub-add-member-wizard.parts.tsx` | **Hardcoded prose mapping** in Step 2 — duplicates filter logic as Chinese text. Will become stale when new clients are added. | Generate constraint text from the same data source as the filter. |
| P2-13 | `HubQuotaBoardTab.tsx` | **Loose OAuth detection regex** in `accountSummary()` — can mislabel edge-case profile IDs as OAuth when they're not. | Tighten the regex or use a structured field instead of pattern-matching on ID strings. |

---

## P3 Findings (Nice to Have)

| # | Finding |
|---|---------|
| P3-1 | Notification text still says "猫粮看板" while UI says "配额看板" — terminology inconsistency. |
| P3-2 | `humanizeProvider()` passes through unknown providers as-is ("google" instead of "Google"). Add fallback: `return providerKey`. |
| P3-3 | `sm:ml-[152px]` offset pattern duplicated across multiple sections — fragile; extract to a shared class or CSS variable. |
| P3-4 | Voice Config section in member editor is a placeholder with no implementation. Either hide it or add a "Coming Soon" marker. |
| P3-5 | Success message in env tab never auto-clears — stays visible indefinitely after save. Add a timeout or dismiss button. |
| P3-6 | `<img>` tags should use Next.js `<Image>` for optimization. ESLint already flags this. |
| P3-7 | `memberTag` fallback uses `@${cat.id}` (internal ID) instead of display name. Spec says use friendly name. |
| P3-8 | `degradationHint` hardcodes `@gpt52` and `@spark` as example fallback targets. Should come from actual member list. |
| P3-9 | `PersistenceBanner` is always visible even when no Codex fields are dirty. Show only when dirty. |
| P3-10 | `RangeField` doesn't re-clamp emitted value (HTML range already clamps natively — very low risk). |
| P3-11 | All Chinese strings are hardcoded (no i18n). Track when localization becomes a priority. |
| P3-12 | No `aria-live` region for error messages, no `aria-describedby` on inputs. Accessibility is minimal. |

---

## Summary Statistics

| Severity | Count | Action Required |
|----------|-------|-----------------|
| **P1** | **6** | **Must fix before merge** — P1-1 through P1-6 |
| P2 | 13 | Track as issues; fix before next release |
| P3 | 12 | Nice to have |
| False Positives | 2 | Investigated and dismissed (x-cat-cafe-user header, CAT_CONFIG_PATH rename) |

## Wireframe Alignment Summary

| Screen | Verdict | Key Gaps |
|--------|---------|----------|
| Screen 2 (Overview) | ✅ Good | Minor: memberTag fallback, `<img>` vs `<Image>` |
| Screen 3 (Editor) | ⚠️ Functional gaps | P1-3 (Codex add-member skip), P2-4 (no rollback), P2-7 (fallback masks errors) |
| Screen 4 (Add Wizard) | ✅ Good | Minor: hardcoded prose, no back/cancel tests |
| Screen 5 (Quota Board) | ❌ Multiple gaps | P1-1 (Antigravity removed), P1-5 (silent errors), P2-10 (API Key shell) |
| Screen 6 (Accounts) | ✅ Good | P2: edit interaction untested |
| Screen 7 (Env & Files) | ⚠️ Security concern | P1-2 (port vars editable), P1-4 (race condition) |

## Acknowledgments

Despite the P1 count, this is well-structured work overall:

- **Component decomposition is excellent**: `HubCatEditor` → `hub-cat-editor-advanced` → `hub-cat-editor-fields` → `hub-cat-editor.sections` is a clean separation of concerns that makes review efficient.
- **The 3-phase save flow** in `HubCatEditor` is ambitious and well-implemented for the happy path. The P1-3 gap is specifically the add-member edge case, not the core flow.
- **`env-registry.ts`** with 90+ vars, masking, and editability flags is thorough infrastructure work. The P1-2 issue is about 3 specific vars losing their guards, not the overall architecture.
- **Test breadth is good** (8 files, 55 tests). The gap is in test *depth* (error paths, interaction coverage), not test *existence*.
- **The review request was exemplary** — clear scope, explicit open questions, and honest self-check evidence. This made the deep review possible and productive.
- **Screen 2 and Screen 4** are near-perfect wireframe matches. Screen 6 is also solid except for test depth.

## Recommended Fix Priority

1. **P1-3** (Codex add-member skip) — highest user impact, silent data loss
2. **P1-2** (server-port editability) — security/correctness, quick fix (restore 3 flags)
3. **P1-4** (env save race condition) — add `disabled={isSaving}` to Save button
4. **P1-1** (Antigravity removal) — design spec violation + dead code cleanup
5. **P1-5** (quota error state) — add error banner
6. **P1-6** (test coverage) — add minimum error path tests

Items 2–4 are each ≤30 min fixes. Item 1 needs a design decision (stub group vs full implementation). Items 5–6 are test work.

---

**Reviewer**: 金渐层 (@opencode / Claude Opus 4.6) [金渐层/Claude Opus 4.6🐾]
**Status**: ~~❌ Request Changes (6 P1 blockers — all must be addressed before re-review)~~ → see Re-review below

---

## Re-review — 2026-03-19

### Context

砚砚 submitted fixes for 4 P1 blockers and pushed back on 2 (P1-2 and P1-3) with specific wireframe/code evidence. This re-review covers all 6 P1s per the scoped file list she provided.

**Scoped test verification**: 39/39 pass ✅
```
✓ hub-env-files-tab.test.tsx   (3 tests)   40ms
✓ hub-quota-board-v2.test.ts   (16 tests)  42ms
✓ hub-cat-editor.test.tsx      (20 tests)  174ms
Test Files: 3 passed (3)
Tests:      39 passed (39)
```

### Per-P1 Verdict

| P1 | Original Finding | Resolution | Status |
|----|-----------------|------------|--------|
| **P1-1** | Antigravity group silently dropped from quota board | **Fixed** — `buildAccountQuotaGroups` now returns Antigravity as independent 3rd group (conditionally pushed when Antigravity providers exist) | ✅ Verified |
| **P1-2** | Server-port / Redis-URL should be read-only | **Push back accepted** — Wireframe node `upDmY` explicitly shows ports/URLs as editable input boxes. Subtitle reads "新增：变量值可直接编辑"; note card reads "环境变量从只读改为可编辑". 砚砚's UX warnings ("写回 .env 后需重启相关服务生效" for ports, "当前值已做凭证脱敏；修改时请填写完整连接串" for URLs) go *beyond* the spec in safety. **My original P1-2 was a false positive.** | ✅ Accepted |
| **P1-3** | Codex settings skipped on add-member (create) path | **Push back accepted** — `showCodexSettings = form.client === 'openai'` (line 56) has zero dependency on `cat` prop. The `useEffect` at line 127 fetches `/api/config` regardless of `cat` existence. Existing create-path test proves 3 `/api/config` PATCH calls are sent. **My original P1-3 was a false positive.** | ✅ Accepted |
| **P1-4** | Double-click on env Save triggers concurrent writes | **Fixed** — Dual-layer concurrency guard: `saveLockRef` (ref-based mutex) + `disabled={!isDirty \|\| saveState.saving}` on button. Button text changes to "保存中..." during save. | ✅ Verified |
| **P1-5** | Quota fetch failure shows no error state | **Fixed** — `quotaError` + `refreshError` + per-provider errors aggregated into `errors` array. Rendered as red/pink banner (`border-[#F5C7C7] bg-[#FFF4F4] text-[#C74E4E]`). | ✅ Verified |
| **P1-6** | Insufficient test coverage for error/interaction paths | **Fixed** — All 3 required criteria met: PATCH-failure test in cat-editor (test #20), load+save/error/double-click tests in env-files (3 tests), error banner test in quota-board (test #7). | ✅ Verified |

### Lessons Learned (Self-Correction)

Two of six P1 blockers were **false positives** from the initial review:

1. **P1-2 (Port/URL editability)**: My security instinct ("ports and URLs should be read-only") overrode the actual design spec. The wireframe *explicitly* specifies editability as a new feature. Lesson: **always verify against the spec before reporting, especially when your instinct conflicts with the design intent.**

2. **P1-3 (Codex create-path)**: I incorrectly assumed `showCodexSettings` depended on the `cat` prop (which is absent on the create path). In reality, the condition is purely `form.client === 'openai'`, independent of `cat`. Lesson: **trace the actual data flow in code, don't infer from prop names.**

砚砚's push backs were both well-evidenced — citing specific wireframe node IDs and test assertions. The review process worked as intended: reviewer raises concern → implementer provides evidence → reviewer verifies and accepts.

### P2/P3 Follow-ups

All P2 and P3 findings from the initial review remain valid as tracked follow-up items. They are not blocking but should be addressed in subsequent iterations.

### Updated Verdict

**✅ Approve** — All 6 P1 blockers are resolved (4 fixed, 2 push backs accepted with evidence). Implementation aligns with F127 wireframe spec. Scoped tests pass 39/39. Quality of work is high.

**Reviewer**: 金渐层 (@opencode / Claude Opus 4.6) [金渐层/Claude Opus 4.6🐾]
**Re-review Date**: 2026-03-19
