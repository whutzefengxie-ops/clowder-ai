#!/usr/bin/env node
/**
 * F203 Phase B: Compile per-cat L0 string from system-prompt-l0.md template.
 *
 * 13 template variables (per-cat, per-invocation):
 *
 *   Static content (L-segments — from individual template files):
 *   {{L1_CONTENT}}          — [L1] 平行世界自我意识
 *   {{L2_CONTENT}}          — [L2] 客观性 carry-over
 *   {{L3_CONTENT}}          — [L3] 路由规则（传球三选一 + @ 路由）
 *   {{L4_CONTENT}}          — [L4] 五条铁律
 *   {{L5_CONTENT}}          — [L5] MCP 工具索引
 *   {{L6_CONTENT}}          — [L6] 能力唤醒指南
 *   {{L7_CONTENT}}          — [L7] 协作哲学
 *
 *   Dynamic per-cat (≈ S-segment equivalents in non-L0 path):
 *   {{IDENTITY_BLOCK}}      — [S1] 身份声明（name/role/personality/model）
 *   {{USER_CAPSULE}}        — per-user profile capsule (F231): owner portrait + optional primer pointer
 *   {{TEAMMATE_ROSTER}}     — [S5] 队友名册（available cats with @mention/model/strengths）
 *   {{GOVERNANCE_L0}}       — [S9] 治理摘要（from shared-rules.md deterministic extraction）
 *   {{WORKFLOW_TRIGGERS}}   — [S6] 工作流触发点（per-breed workflow triggers）
 *   {{CVO_REF}}             — [S8] co-creator引用（co-creator name + mention handles）
 *
 * Output: string ready for `claude --system-prompt <out>` or
 * `codex exec -c 'developer_instructions=<out>'`.
 *
 * Usage:
 *   import { compileL0 } from './scripts/compile-system-prompt-l0.mjs';
 *   const l0 = await compileL0({ catId: 'opus-47' });
 *
 * CLI:
 *   node scripts/compile-system-prompt-l0.mjs --cat opus-47
 *
 * S6 workflow triggers are loaded from assets/prompt-templates/workflow-triggers.yaml
 * with the same .cat-cafe/prompt-overlays/workflow-triggers.local.yaml overlay
 * path as the non-native SystemPromptBuilder path.
 */

import { createHash } from 'node:crypto';
import { accessSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  catRegistry,
  collectRosterFamilyLabels,
  formatRosterLabel,
  resolveL0Projections,
  resolvePromptTemplateVariables,
} from '@cat-cafe/shared';
import { getDossierL0Pronouns, getDossierL0RoutingNote, getDossierL0SelfDescription } from '@cat-cafe/shared/dossier';
import {
  CURRENT_CORPUS_PROFILE_URI,
  CURRENT_RELATIONSHIP_PROFILE_URI,
  DEFAULT_PROFILE_USER_ID,
  profileCapsuleReadRelativePath,
  profileCorpusRelativePath,
  profileUserRelativePath,
  relationshipPrimerRelativePath,
  renderUserCapsuleSection,
} from '@cat-cafe/shared/profile-contract';
import YAML from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEMPLATE_PATH = resolve(REPO_ROOT, 'assets/system-prompts/system-prompt-l0.md');
const PROMPT_TEMPLATES_DIR = resolve(REPO_ROOT, 'assets/prompt-templates');
const PUBLIC_PARTICIPATION_TEMPLATE_PATH = resolve(PROMPT_TEMPLATES_DIR, 'l0-public-participation.md');
const PROMPT_OVERLAYS_DIR = resolve(findWorkspaceRoot(process.cwd()), '.cat-cafe', 'prompt-overlays');
const DISPLAY_SEGMENT_LABEL_RE = /^── \[[A-Z]\d+] .+──$/;
const MERGE_GATE_SOURCE_PROVENANCE_TRIGGER = '- MG provenance override：外部finding修完后等PR truth，不@旧reviewer。';

/** L1-L7 section template files — static content extracted from the monolithic L0 template. */
const L0_SECTION_TEMPLATES = {
  L1_CONTENT: 'l1-parallel-world.md',
  L2_CONTENT: 'l2-carry-over.md',
  L3_CONTENT: 'l3-routing-rules.md',
  L4_CONTENT: 'l4-iron-laws.md',
  L5_CONTENT: 'l5-mcp-tools-index.md',
  L6_CONTENT: 'l6-capability-wakeup.md',
  L7_CONTENT: 'l7-collaboration-philosophy.md',
};

function findWorkspaceRoot(start) {
  let dir = resolve(start);
  while (dir !== dirname(dir)) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    dir = dirname(dir);
  }
  return resolve(start);
}

/**
 * Load an L0 section template file, stripping compiler-only annotation lines.
 * Returns the content with leading/trailing whitespace trimmed.
 */
function loadL0SectionTemplate(filename) {
  const filePath = resolve(PROMPT_TEMPLATES_DIR, filename);
  const raw = readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => !isCompilerAnnotationLine(line))
    .join('\n')
    .trim();
}

function isCompilerAnnotationLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith('<!--') || DISPLAY_SEGMENT_LABEL_RE.test(trimmed);
}

let _bootstrapped = false;
// 云端 review round-2 P1: bootstrap 必须用 no-arg loadCatConfig()——
// 它做 template base + `.cat-cafe/cat-catalog.json` overlay deep merge
// (cat-config-loader.ts:307-327)，反映 runtime 真相（含 disabled 猫）。
// 旧实现 loadCatConfig(CAT_TEMPLATE_PATH) 显式 path 跳过 catalog overlay
// → isCatAvailable 基于 stale template → round-1 P2 fix 实际无效
// （dead-end @ 路由没真正防住）。no-arg DEFAULT 反推 worktree root
// cat-template.json + 同目录 catalog overlay，路径正确。
// 测试隔离：测试可设 process.env.CAT_TEMPLATE_PATH 指向隔离 template。
let _loadedConfig = null;
let _isCatAvailable = null;
let _getCatModel = null;
let _loadCompiledGovernanceL0 = null;
// Phase C Task 1 (A8 gap): operator ref handles 必须来自 co-creator config
// 渲染（buildStaticIdentity L568-571 同源），非 L0 硬编码 @co-creator——
// 否则删 user message 后 co-creator 多 handle / 自定义 name 丢失。
let _coCreatorConfig = null;
async function bootstrapCatRegistry() {
  if (_bootstrapped) return;
  const { loadCatConfig, toAllCatConfigs, isCatAvailable, getCoCreatorConfig } = await import(
    '../packages/api/dist/config/cat-config-loader.js'
  );
  const { getCatModel } = await import('../packages/api/dist/config/cat-models.js');
  const { loadCompiledGovernanceL0 } = await import(
    '../packages/api/dist/domains/cats/services/context/governance-l0.js'
  );
  _loadedConfig = loadCatConfig(); // no-arg: template + catalog overlay (runtime truth)
  _isCatAvailable = isCatAvailable;
  _getCatModel = getCatModel;
  _loadCompiledGovernanceL0 = loadCompiledGovernanceL0;
  _coCreatorConfig = getCoCreatorConfig(_loadedConfig);
  const allConfigs = toAllCatConfigs(_loadedConfig);
  for (const [id, config] of Object.entries(allConfigs)) {
    if (!catRegistry.has(id)) {
      catRegistry.register(id, config);
    }
  }
  _bootstrapped = true;
}

/**
 * 云端 review P1: 跨平台 CLI 入口检测。
 * 旧实现 `import.meta.url === \`file://${process.argv[1]}\`` 只匹配
 * POSIX 路径；Windows argv1=`C:\...` 而 import.meta.url=`file:///C:/...`
 * → 条件恒 false，CLI path 在 Windows 永不执行。改用 Node 自己的
 * fileURLToPath + resolve 做绝对路径比较（处理相对 argv1 + Windows 盘符）。
 */
export function isCliEntrypoint(metaUrl, argv1) {
  if (!argv1) return false;
  try {
    // Desktop packaged layout: service-manager mirrors scripts/ into a
    // user-writable project dir via symlink (project/scripts → .app/.../
    // Resources/scripts). Node ESM resolves import.meta.url to the real
    // path (inside .app) while process.argv[1] keeps the symlink path
    // → naive comparison always mismatches → CLI entry never fires.
    // realpathSync both sides so symlink vs real path compares correctly.
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(resolve(argv1));
  } catch {
    return false;
  }
}

/**
 * 云端 review P2: 队友名册只列 available 猫。
 * disabled 猫进 roster → handoff 指令 @ 已下线猫 = dead-end 路由。
 * 纯函数，可注入 isAvailableFn 测试。
 */
export function filterAvailableTeammates(allConfigs, currentCatId, isAvailableFn) {
  return Object.entries(allConfigs).filter(([id]) => id !== currentCatId && isAvailableFn(id));
}

/**
 * Relationship persona ownership is explicit catalog data. UI breed grouping,
 * model names, and client providers are not stable identity boundaries.
 */
export function resolveRelationshipKey(config, catId) {
  if (!config.relationshipKey) {
    throw new Error(`No relationshipKey configured for catId "${catId}"; refusing breed/model inference`);
  }
  return config.relationshipKey;
}

function workflowTriggersBasePath(filename) {
  return resolve(PROMPT_TEMPLATES_DIR, filename);
}

function workflowTriggersOverlayPath(filename) {
  return resolve(PROMPT_OVERLAYS_DIR, filename);
}

function parseWorkflowTriggersFile(filePath) {
  const parsed = YAML.parse(readFileSync(filePath, 'utf-8'));
  if (parsed == null || typeof parsed !== 'object') return {};

  const result = {};
  for (const [breed, content] of Object.entries(parsed)) {
    if (typeof content === 'string') {
      result[breed] = ensureMergeGateSourceProvenanceTrigger(renderEditionVariables(content.trimEnd()));
    }
  }
  return result;
}

function renderEditionVariables(template, dynamic = {}) {
  const variables = { ...resolvePromptTemplateVariables(), ...dynamic };
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => (Object.hasOwn(variables, key) ? variables[key] : match));
}

function ensureMergeGateSourceProvenanceTrigger(content) {
  if (content.includes('MG provenance override') && content.includes('外部finding修完后等PR truth')) {
    return content;
  }
  return `${content.trimEnd()}\n${MERGE_GATE_SOURCE_PROVENANCE_TRIGGER}`;
}

function loadWorkflowTriggers(paths) {
  const basePath = paths?.basePath ?? workflowTriggersBasePath('workflow-triggers.yaml');
  const localPath = paths ? paths.overlayPath : workflowTriggersOverlayPath('workflow-triggers.local.yaml');
  const effectivePath = localPath && existsSync(localPath) ? localPath : basePath;

  if (!existsSync(effectivePath)) {
    console.warn('[compile-l0] workflow-triggers.yaml not found, using empty map');
    return {};
  }

  try {
    return parseWorkflowTriggersFile(effectivePath);
  } catch (err) {
    console.warn(`[compile-l0] malformed YAML in ${effectivePath}: ${err}`);
    if (effectivePath === localPath && localPath && existsSync(basePath)) {
      try {
        return parseWorkflowTriggersFile(basePath);
      } catch {
        console.warn('[compile-l0] base workflow-triggers.yaml also malformed, using empty map');
      }
    }
    return {};
  }
}

/** Frozen identity lines from the parent's identity authority decision. */
function buildResolvedIdentityLines(resolvedIdentity) {
  if (resolvedIdentity.selfDescription) {
    return [`角色与自我校准：${resolvedIdentity.selfDescription.text}`];
  }
  const lines = [`角色：${resolvedIdentity.roleDescription.value}`, `性格：${resolvedIdentity.personality.value}`];
  const supplementary = resolvedIdentity.supplementary ?? [];
  if (supplementary.length > 0) {
    lines.push('', '补充事实（dossier，独立来源）：');
    for (const fact of supplementary) lines.push(`- ${fact.text}`);
  }
  return lines;
}

/** Legacy diagnostics path: dossier self-description first, then config fields. */
function buildLegacyIdentityLines(config, dossierRoot) {
  const selfDescription = getDossierL0SelfDescription(config.catId, dossierRoot);
  if (selfDescription) return [`角色与自我校准：${selfDescription}`];
  return [`角色：${config.roleDescription}`, `性格：${config.personality}`];
}

export function buildIdentityBlock(config, runtimeModel, dossierRoot, resolvedIdentity) {
  const nameLabel = config.nickname
    ? `${config.displayName}/${config.nickname}（${config.name}）`
    : `${config.displayName}（${config.name}）`;
  const lines = [`你是 ${nameLabel}。`];
  if (config.nickname) {
    lines.push(`昵称 "${config.nickname}" 的由来见 \`docs/stories/cat-names/\`。`);
  }
  // W2 frozen path: the parent already decided identity authority. An explicit
  // saved config identity wins and the conflicting dossier self-description is
  // not injected (it was suppressed and reported in the preview). Members
  // without an explicit identity keep the legacy dossier self-description
  // byte-for-byte.
  lines.push(
    ...(resolvedIdentity
      ? buildResolvedIdentityLines(resolvedIdentity)
      : buildLegacyIdentityLines(config, dossierRoot)),
  );
  // Bug fix: CLI 不传 runtimeModel 导致 L0 缺模型号，猫读 CLAUDE.md 硬编码签名出错。
  // fallback 链：runtimeModel（显式传入）> resolveModel（env override）> defaultModel。
  const resolvedModel = runtimeModel || resolveModel(config.catId ?? '', config);
  if (resolvedModel) {
    lines.push(`Identity constant: \`@${config.catId ?? ''}\` model=${resolvedModel}`);
  }
  if (config.restrictions && config.restrictions.length > 0) {
    lines.push('');
    lines.push(`**硬限制**：${config.restrictions.join('、')}。被 @ 做这类任务时请 push back 或退回给 @ 你的猫。`);
  }
  return lines.join('\n');
}

/**
 * Public participation may use only identity fields already declared by the
 * participation profile. It must not inherit dossier text, restrictions,
 * teammate routing, model bindings, owner references, or local overlays.
 */
function buildPublicIdentityBlock(catId) {
  // The signed Host prompt supplies revision-bound published profile fields.
  // L0 keeps only the stable addressee; rereading mutable local catalog text
  // here could expose bytes that were never part of that published revision.
  return `Identity constant: \`@${catId}\``;
}

function compilePublicParticipationL0(catId) {
  return readFileSync(PUBLIC_PARTICIPATION_TEMPLATE_PATH, 'utf8')
    .split('\n')
    .filter((line) => !isCompilerAnnotationLine(line))
    .join('\n')
    .replace('{{PUBLIC_IDENTITY_BLOCK}}', buildPublicIdentityBlock(catId));
}

// 云端 review round-2 P2: roster 列标"当前模型"，必须 runtime resolve
// （getCatModel: env CAT_{CATID}_MODEL override > catRegistry），不能用
// 静态 cfg.defaultModel——否则 env model override 下广告错误队友模型，
// 误导 handoff。对齐 SystemPromptBuilder.ts:434（既定 runtime 模式）。
function resolveModel(id, cfg) {
  if (_getCatModel) {
    try {
      return _getCatModel(id);
    } catch {
      // getCatModel throws if cat unknown — fall back to static defaultModel
    }
  }
  return cfg.defaultModel ?? '';
}

/**
 * Build one roster row from already-resolved routing facts.
 * `resolved` carries { model, pronouns, routingNote }; the legacy caller
 * resolves them from the live registry/dossier, the frozen caller reads them
 * from the captured payload. Byte-identical for the same inputs.
 */
function buildRosterRowFromResolved(id, cfg, resolved, familyLabels) {
  const mention = cfg.mentionPatterns?.[0] ?? `@${id}`;
  const cell = resolved.model ? `${mention} · ${resolved.model}` : mention;
  const pronouns = resolved.pronouns ? resolved.pronouns.split('/')[0]?.trim() : undefined;
  // Chinese L0 only needs the Chinese pronoun. The dossier marker limits this
  // scarce surface to evidence-backed repeat failures instead of every profile.
  // Prefer the shorter nickname for marked rows so the reminder is token-negative.
  const baseLabel = formatRosterLabel(cfg, familyLabels);
  const label = pronouns ? `${cfg.nickname ?? baseLabel}（${pronouns}）` : baseLabel;
  const hasRestrictions = cfg.restrictions && cfg.restrictions.length > 0;
  const restrictions = hasRestrictions ? `**硬限制**：${cfg.restrictions.join('、')}` : null;
  // F234 Phase L0-GD: the always-on roster is a routing contract, not a
  // capability dossier. Prefer the explicit compact route note; keep config
  // caution as a compatibility fallback for runtime/custom cats that have not
  // yet acquired a structured dossier profile. Hard restrictions always stay.
  const routingNote = resolved.routingNote;
  const routeContract = [routingNote, restrictions].filter(Boolean).join('；') || '—';
  return `| ${label} | ${cell} | ${routeContract} |`;
}

export function buildRosterRow(id, cfg, dossierRoot, familyLabels) {
  return buildRosterRowFromResolved(
    id,
    cfg,
    {
      model: resolveModel(id, cfg),
      pronouns: getDossierL0Pronouns(id, dossierRoot),
      routingNote: getDossierL0RoutingNote(id, dossierRoot) ?? cfg.caution,
    },
    familyLabels,
  );
}

function buildTeammateRosterRows(entries) {
  if (entries.length === 0) return '（无其他可用队友）';

  const rows = ['## 队友名册', '| 猫猫 | @mention · 当前模型 | 路由边界 |', '|------|---------|------|'];
  const familyLabels = collectRosterFamilyLabels(entries.map((entry) => entry.config));
  for (const entry of entries) {
    rows.push(buildRosterRowFromResolved(entry.catId, entry.config, entry.resolved, familyLabels));
  }
  return rows.join('\n');
}

function buildTeammateRoster(currentCatId, dossierRoot) {
  const allConfigs = catRegistry.getAllConfigs();
  const teammates = filterAvailableTeammates(
    allConfigs,
    currentCatId,
    (id) => !_isCatAvailable || _isCatAvailable(id, _loadedConfig),
  );
  const entries = teammates.map(([id, cfg]) => ({
    catId: id,
    config: cfg,
    resolved: {
      model: resolveModel(id, cfg),
      pronouns: getDossierL0Pronouns(id, dossierRoot),
      routingNote: getDossierL0RoutingNote(id, dossierRoot) ?? cfg.caution,
    },
  }));
  return buildTeammateRosterRows(entries);
}

/** Frozen roster: no registry/dossier reads, only the captured payload entries. */
function buildTeammateRosterFromFrozen(roster) {
  const entries = (roster ?? []).map((entry) => ({
    catId: entry.catId,
    config: entry.config,
    resolved: {
      model: entry.runtimeModel,
      pronouns: entry.pronouns,
      routingNote: entry.routingNote,
    },
  }));
  return buildTeammateRosterRows(entries);
}

/**
 * Resolve the production L0 coverage cohort from the same catalog/availability
 * truth used by compilation. Tests and diagnostics must not maintain a second
 * hand-written cat list.
 */
export async function getAvailableL0CatIds() {
  await bootstrapCatRegistry();
  return Object.keys(catRegistry.getAllConfigs()).filter((id) => _isCatAvailable(id, _loadedConfig));
}

// F203 Phase B fix: 现有 SystemPromptBuilder.ts:554 对 breedId 不在
// {ragdoll,maine-coon,siamese} 的 cat（如 opus-47，breedId='opus-47'）
// 无 workflow triggers（既有 gap，S1 baseline 实测 opus-47 workflow=0t）。
// 这里加 displayName→breed fallback 修这个 gap：opus-47 是布偶猫家族，
// 应共享 ragdoll workflow。**行为变更**：见 F203 spec KD-8。
const DISPLAY_NAME_TO_BREED = {
  布偶猫: 'ragdoll',
  缅因猫: 'maine-coon',
  暹罗猫: 'siamese',
};

function buildWorkflowTriggers(breedId, catId, displayName, triggerPaths) {
  const workflowTriggers = loadWorkflowTriggers(triggerPaths);
  const direct = workflowTriggers[breedId] ?? workflowTriggers[catId];
  if (direct) return direct;
  const familyBreed = Object.entries(DISPLAY_NAME_TO_BREED).find(([familyName]) =>
    displayName?.startsWith(familyName),
  )?.[1];
  if (familyBreed && workflowTriggers[familyBreed]) {
    return workflowTriggers[familyBreed];
  }
  return '## 工作流\n（无 per-breed 触发点配置）';
}

// Phase C Task 1 (A8 gap): 渲染 operator reference 行，对齐 buildStaticIdentity
// L568-571（co-creator config 动态 name + mentionPatterns），替代 L0 §4
// 硬编码 @co-creator。删 user message 后这是猫认 operator + 路由 handle 的唯一来源。
function renderCvoRefFrom(coCreatorConfig) {
  if (!coCreatorConfig) return '';
  const name = coCreatorConfig.name;
  const handles = (coCreatorConfig.mentionPatterns ?? []).map((p) => `\`${p}\``).join(' / ');
  return `${name}（co-creator/operator）。重要决策由${name}拍板。需要关注时行首写 ${handles}。`;
}

function renderCvoRef() {
  return renderCvoRefFrom(_coCreatorConfig);
}

// ─── F231: User profile capsule resolution ────────────────────────────────
// Contract (F231 spec KD-7 + Phase A plan §三):
//   profileDir is supplied by the canonical data-root repository; this compiler never guesses cwd.
//   capsule.md is canonical; the old filename is read only when it is absent.
//   Three states:
//     missing/unreadable → '' (empty string, no heading — backward compat)
//     ≤300 Unicode chars  → '## 主人画像\n\n{body}' + optional primer pointer
//     >300 Unicode chars  → throw (compilation must fail loudly)
//   Primer pointer: if relationship/{relationshipKey}-primer.md exists → append logical URI
//   Pointer line does NOT count toward 300-char limit.

/**
 * Resolve user profile capsule for L0 injection.
 *
 * @param {string} profileDir - authenticated owner's profile directory
 * @param {string} relationshipKey - stable persona key from CatConfig.relationshipKey
 * @returns {string} available capsule section and/or logical relationship-profile pointer
 * @throws {Error} if capsule exceeds 300 Unicode characters
 */
export function resolveUserCapsule(profileDir, relationshipKey) {
  const capsulePath = resolve(
    profileDir,
    profileCapsuleReadRelativePath((path) => existsSync(resolve(profileDir, path))),
  );
  const primerPath = resolve(profileDir, relationshipPrimerRelativePath(relationshipKey));
  const corpusPath = resolve(profileDir, profileCorpusRelativePath());
  let primerEntry = '';
  let corpusEntry = '';
  try {
    accessSync(primerPath);
    primerEntry = `关系轨迹: ${CURRENT_RELATIONSHIP_PROFILE_URI}（cat_cafe_read_profile 按需读）`;
  } catch {
    // No primer for this persona — no pointer line.
  }
  // Phase E: corpus pointer — existence-gated, never leaks content into L0 (INV-6 no existence leakage
  // is about non-owner; owner sees pointer only when file exists).
  try {
    accessSync(corpusPath);
    corpusEntry = `共享事实: ${CURRENT_CORPUS_PROFILE_URI}（cat_cafe_read_profile layer=corpus 按需读）`;
  } catch {
    // No corpus yet — no pointer line.
  }

  const entries = [primerEntry, corpusEntry].filter(Boolean);
  const pointers = entries.length
    ? [...entries, '读源走本轮绑定的 Clowder AI 连接；勿用独立 App 的同名工具替代。'].join('\n')
    : '';

  // State 1: missing / unreadable → pointer entries only, if any exist.
  // Capsule, primer, and corpus are independently optional profile layers.
  let raw;
  try {
    raw = readFileSync(capsulePath, 'utf8');
  } catch {
    return pointers;
  }

  // The same pure transform is used by F299 when binding durable profile
  // evidence, so the sourceRef describes these exact bytes rather than a
  // later profile revision.
  let section = renderUserCapsuleSection(raw);
  if (!section) {
    return pointers;
  }
  if (pointers) section += `\n\n${pointers}`;

  return section;
}

// -- Frozen input mode (W2 / C06) -------------------------------------------
// Production invocations must render an already resolved input snapshot. The
// parent process passes a v1 JSON payload via --frozen-input; this child then
// validates the payload and renders only it. It MUST NOT bootstrap the
// registry or reload member configuration from disk in this mode (that is why
// the payload carries members/roster/runtimeModel/identity/governance/capsule).
// Missing, unsupported, unresolvable or tampered payloads fail closed with a
// non-zero exit; there is no fallback to reading the live catalog.

export const L0_FROZEN_INPUT_VERSION = 1;

function canonicalizeFrozenInputValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeFrozenInputValue);
  if (value !== null && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      const child = value[key];
      if (child !== undefined) sorted[key] = canonicalizeFrozenInputValue(child);
    }
    return sorted;
  }
  return value;
}

/** SHA-256 over the canonicalized payload body (everything except `digest`). */
export function computeFrozenInputDigest(payload) {
  const { digest: _digest, ...body } = payload;
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeFrozenInputValue(body)))
    .digest('hex');
}

function assertFrozenProjection(projection) {
  if (!resolveL0Projections().includes(projection)) {
    throw new Error(`unsupported frozen input projection "${String(projection)}"`);
  }
}

function parseFrozenInputFile(inputPath) {
  let raw;
  try {
    raw = readFileSync(inputPath, 'utf8');
  } catch (err) {
    throw new Error(`frozen input unreadable: ${err?.code ?? err?.message ?? 'unknown error'}`);
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    throw new Error(`frozen input is not valid JSON: ${err.message}`);
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('frozen input must be a JSON object');
  }
  return payload;
}

function assertFrozenEnvelope(payload) {
  if (payload.version !== L0_FROZEN_INPUT_VERSION) {
    throw new Error(`unsupported frozen input version ${String(payload.version)}; expected ${L0_FROZEN_INPUT_VERSION}`);
  }
  if (typeof payload.catId !== 'string' || payload.catId.length === 0) {
    throw new Error('frozen input is missing catId');
  }
  assertFrozenProjection(payload.projection);
  if (typeof payload.digest !== 'string' || payload.digest.length === 0) {
    throw new Error('frozen input is missing its digest');
  }
  if (computeFrozenInputDigest(payload) !== payload.digest) {
    throw new Error('frozen input digest mismatch (payload was modified after capture)');
  }
}

function assertFrozenOwnerPayload(payload) {
  if (!Array.isArray(payload.members) || !payload.members.some((member) => member?.catId === payload.catId)) {
    throw new Error(`frozen input is missing resolved member "${payload.catId}"`);
  }
  if (payload.identity === null || typeof payload.identity !== 'object') {
    throw new Error('frozen input is missing identity authority');
  }
  if (typeof payload.governanceL0 !== 'string') {
    throw new Error('frozen input is missing governanceL0 text');
  }
  if (typeof payload.capsule !== 'string') {
    throw new Error('frozen input is missing capsule text');
  }
  if (!Array.isArray(payload.roster)) {
    throw new Error('frozen input is missing the teammate roster');
  }
  if (payload.workflowTriggers === null || typeof payload.workflowTriggers?.basePath !== 'string') {
    throw new Error('frozen input is missing workflow trigger paths');
  }
}

/**
 * Read and structurally validate a frozen input payload.
 * @param {string} inputPath absolute or cwd-relative path to the v1 JSON payload
 * @returns {Object} validated payload
 * @throws {Error} on unreadable/malformed/unsupported/tampered payloads
 */
export function loadFrozenInput(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.length === 0) {
    throw new Error('frozen input path is required');
  }
  const payload = parseFrozenInputFile(inputPath);
  assertFrozenEnvelope(payload);
  if (payload.projection === 'owner') assertFrozenOwnerPayload(payload);
  return payload;
}

/**
 * Render L0 from a validated frozen payload without any registry reload.
 * @param {Object} payload validated v1 payload
 * @returns {string} compiled L0
 */
export function compileFrozenL0(payload) {
  if (payload.projection === 'public') return compilePublicParticipationL0(payload.catId);
  const member = payload.members.find((candidate) => candidate?.catId === payload.catId);
  if (!member || member.config === null || typeof member.config !== 'object') {
    throw new Error(`frozen input is missing resolved configuration for "${payload.catId}"`);
  }
  const config = { ...member.config, catId: payload.catId };
  const identityBlock = buildIdentityBlock(config, payload.runtimeModel, REPO_ROOT, payload.identity);
  const rosterBlock = buildTeammateRosterFromFrozen(payload.roster);
  const workflowTriggers = buildWorkflowTriggers(
    config.breedId,
    payload.catId,
    config.displayName,
    payload.workflowTriggers,
  );
  return renderL0Document({
    identityBlock,
    capsuleSection: payload.capsule,
    rosterBlock,
    governanceL0: payload.governanceL0,
    workflowTriggers,
    cvoRef: renderCvoRefFrom(payload.coCreator),
  });
}

/**
 * Render the L0 document from already-resolved section bodies.
 * Shared by the legacy compile path and the frozen render path so both produce
 * the same bytes for the same inputs.
 */
function renderL0Document(sections) {
  // Strip compiler-only annotation lines from the main template (same as
  // loadL0SectionTemplate does for L-section files). Allows rich source labels
  // without changing the compiled output sent to the model.
  const template = readFileSync(TEMPLATE_PATH, 'utf8')
    .split('\n')
    .filter((line) => !isCompilerAnnotationLine(line))
    .join('\n');
  // Load L1-L7 section templates (static content extracted to individual files)
  let result = template;
  for (const [placeholder, filename] of Object.entries(L0_SECTION_TEMPLATES)) {
    result = result.replace(`{{${placeholder}}}`, loadL0SectionTemplate(filename));
  }
  // One pass over source placeholders: inserted labels, capsules and overlays
  // stay opaque, even when their data happens to contain a placeholder spelling.
  return renderEditionVariables(result, {
    IDENTITY_BLOCK: sections.identityBlock,
    USER_CAPSULE: sections.capsuleSection,
    TEAMMATE_ROSTER: sections.rosterBlock,
    GOVERNANCE_L0: sections.governanceL0,
    WORKFLOW_TRIGGERS: sections.workflowTriggers,
    CVO_REF: sections.cvoRef,
  });
}

/**
 * Compile per-cat L0 string by substituting template variables.
 *
 * @param {Object} options
 * @param {string} options.catId - cat ID (must be registered in catRegistry)
 * @param {string} [options.runtimeModel] - resolved runtime model (e.g. claude-opus-4-7)
 * @param {string} [options.profileDir] - override for user profile directory (fixture isolation)
 * @param {string} [options.dossierRoot] - explicit installation dossier root; defaults to the source repository
 * @param {string} [options.projection='owner'] - must be supported by the active deployment's L0 projection policy
 * @returns {Promise<string>} compiled L0 ready for system-prompt injection
 */
export async function compileL0(options) {
  const { catId, runtimeModel, profileDir, projection = 'owner', dossierRoot = REPO_ROOT } = options;
  if (!resolveL0Projections().includes(projection)) {
    throw new Error(`compileL0: unsupported projection "${projection}"`);
  }
  await bootstrapCatRegistry();
  const entry = catRegistry.tryGet(catId);
  if (!entry) {
    throw new Error(`compileL0: unknown catId "${catId}". Registered: ${catRegistry.getAllIds().join(', ')}`);
  }
  const config = { ...entry.config, catId };
  // Public output is constructed from a dedicated allowlist. Branch before
  // reading owner profiles, governance overlays, workflow overlays, teammate
  // routing, or the co-creator reference so none can become model-visible.
  if (projection === 'public') return compilePublicParticipationL0(catId);

  const governanceL0 = await _loadCompiledGovernanceL0(REPO_ROOT);

  // Runtime callers pass a user-scoped profileDir. Direct compiles use the same
  // canonical repository contract for the default user; legacy worktree-local
  // private/profile trees are migration inputs only.
  let capsuleSection = '';
  if (projection === 'owner') {
    const canonicalDataDir = resolve(process.env.CAT_CAFE_DATA_DIR ?? resolve(homedir(), '.cat-cafe'));
    const resolvedProfileDir =
      profileDir ?? resolve(canonicalDataDir, ...profileUserRelativePath(DEFAULT_PROFILE_USER_ID).split('/'));
    const relationshipKey = resolveRelationshipKey(config, catId);
    capsuleSection = resolveUserCapsule(resolvedProfileDir, relationshipKey);
  }

  return renderL0Document({
    identityBlock: buildIdentityBlock(config, runtimeModel, dossierRoot),
    capsuleSection,
    rosterBlock: buildTeammateRoster(catId, dossierRoot),
    governanceL0: governanceL0.content,
    workflowTriggers: buildWorkflowTriggers(config.breedId, catId, config.displayName),
    cvoRef: renderCvoRef(),
  });
}

/**
 * Compile per-cat L0 and write to a file.
 *
 * operator directive 2026-05-15: 完全替换不在 ts/js 硬编码 L0 内容——Phase C
 * 用 `claude --system-prompt-file <path>` 从文件读。compile 渲染 per-cat
 * L0 → 写文件 → spawn 引用文件路径（内容真相源始终是 system-prompt-l0.md）。
 *
 * @param {Object} options - same as compileL0 ({ catId, runtimeModel? })
 * @param {string} outPath - absolute path to write compiled L0
 * @returns {Promise<string>} the compiled L0 (also written to outPath)
 */
export async function writeL0File(options, outPath) {
  const compiled = await compileL0(options);
  writeFileSync(outPath, compiled, 'utf8');
  return compiled;
}

// CLI:
//   node scripts/compile-system-prompt-l0.mjs --cat opus-47            → stdout
//   node scripts/compile-system-prompt-l0.mjs --cat opus-47 --out p.md → write file
//   node scripts/compile-system-prompt-l0.mjs --cat opus-47 --profile-dir /abs/path
//     → override profile directory (gpt52 review P1: fixes symlink/packaged layouts)
//   node scripts/compile-system-prompt-l0.mjs --cat opus-47 --projection public
//     → allowlisted public identity/collaboration contract; no owner-local overlays
//   node scripts/compile-system-prompt-l0.mjs --frozen-input /abs/frozen.json [--out p.md]
//     → production path: render only the captured payload, never reload the catalog
if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const args = process.argv.slice(2);
  const catIdx = args.indexOf('--cat');
  const frozenIdx = args.indexOf('--frozen-input');
  const profileDirIdx = args.indexOf('--profile-dir');
  const projectionIdx = args.indexOf('--projection');
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const requestedProjection = projectionIdx >= 0 ? args[projectionIdx + 1] : undefined;
  const usage = `Usage: node scripts/compile-system-prompt-l0.mjs --cat <catId> [--out <path>] [--profile-dir <path>] [--projection ${resolveL0Projections().join('|')}]\n       node scripts/compile-system-prompt-l0.mjs --frozen-input <jsonPath> [--cat <catId>] [--out <path>]`;

  if (frozenIdx >= 0) {
    const inputPath = args[frozenIdx + 1];
    if (!inputPath) {
      console.error(usage);
      process.exit(2);
    }
    let payload;
    try {
      payload = loadFrozenInput(inputPath);
    } catch (err) {
      console.error(`[compile-l0] frozen input rejected: ${err.message}`);
      process.exit(3);
    }
    const requestedCatId = catIdx >= 0 ? args[catIdx + 1] : undefined;
    if (requestedCatId && requestedCatId !== payload.catId) {
      console.error(`[compile-l0] --cat "${requestedCatId}" does not match frozen input catId "${payload.catId}"`);
      process.exit(3);
    }
    if (profileDirIdx >= 0) {
      console.error(
        '[compile-l0] --profile-dir is not accepted with --frozen-input; the capsule is captured in the payload',
      );
      process.exit(3);
    }
    if (requestedProjection && requestedProjection !== payload.projection) {
      console.error(
        `[compile-l0] --projection "${requestedProjection}" does not match frozen input projection "${payload.projection}"`,
      );
      process.exit(3);
    }
    let compiled;
    try {
      compiled = compileFrozenL0(payload);
    } catch (err) {
      console.error(`[compile-l0] frozen compile failed: ${err.message}`);
      process.exit(4);
    }
    if (outPath) {
      writeFileSync(outPath, compiled, 'utf8');
      console.error(`Wrote compiled L0 for ${payload.catId} → ${outPath}`);
    } else {
      process.stdout.write(compiled);
    }
  } else if (catIdx < 0 || !args[catIdx + 1]) {
    console.error(usage);
    process.exit(2);
  } else {
    const catId = args[catIdx + 1];
    const profileDir = profileDirIdx >= 0 ? args[profileDirIdx + 1] : undefined;
    const projection = requestedProjection;
    if (outPath) {
      await writeL0File({ catId, profileDir, projection }, outPath);
      console.error(`Wrote compiled L0 for ${catId} → ${outPath}`);
    } else {
      process.stdout.write(await compileL0({ catId, profileDir, projection }));
    }
  }
}
