export function modeSettings(config, state, esc) {
  const version = config.mode === 'version';
  const rules = `<div class="split"><label>内部保留文件 / 目录（每行一项）<textarea name="internalPaths" rows="4" placeholder="internal-docs/&#10;README.internal.md">${esc((config.internalPaths ?? []).join('\n'))}</textarea></label><label>共同修改的文件（每行一项）<textarea name="mergePaths" rows="4" placeholder="README.md">${esc((config.mergePaths ?? []).join('\n'))}</textarea></label></div>`;
  return `<section class="card"><h2>1 · 选择同步方式</h2>${state ? `<span class="badge">${version ? '按版本更新' : '同步开发过程'}</span><p>${version ? '按 tag 接收版本内容，保留内部差异，只创建一个内部同步 PR。' : '按 main 的实际落地 PR 逐笔同步 Issue 与原始对象，整个核心文件树保持一致。'}</p>${lockedRules(config, esc)}<small>已启用绑定的模式与规则已固定。另一种模式请使用独立台账目录，避免覆盖进行中的交付。</small>` : `<form data-form="configure"><label for="sync-mode">同步模式</label><select id="sync-mode" name="mode"><option value="continuous" ${!version ? 'selected' : ''}>同步开发过程 · 搬运 Issue / PR</option><option value="version" ${version ? 'selected' : ''}>按版本更新 · 保留内部差异</option></select><p>开发过程同步要求核心文件一致；按版本更新支持内部特有文件和共同文件合并。</p><div data-policy ${version ? '' : 'hidden'}><h3>2 · 声明内部差异</h3>${rules}<p>目录以 / 结尾。内部保留规则保留整个文件，包含上游同名文件的变更也会跳过；共同修改规则进行三方合并。其余路径必须与基线一致。</p></div><button class="primary" type="submit">保存同步方式与规则</button></form>`}</section>`;
}
export function tagSelector(tags, esc, sha) {
  return `<section class="card task"><span class="badge">按版本更新 · 一个同步 PR</span><h2>选择要接收的上游版本</h2><p>内部定制文件按已声明规则保留。不会搬运上游 Issue 或逐个创建上游 PR。</p><button data-action="tags" type="button">读取可用 tag</button>${tags.length ? `<form data-form="select-tag"><label>目标 tag<select name="tag">${tags.map((tag) => `<option value="${esc(tag.name)}">${esc(tag.name)} · ${esc(tag.commit.slice(0, 12))}</option>`).join('')}</select></label><button class="primary" type="submit">核对内部差异并选择这个版本 →</button></form><details><summary>查看标签与准确 commit 对应</summary>${tags.map((tag) => `<p>${esc(tag.name)} → ${sha(tag.commit)}</p>`).join('')}</details>` : '<p>先读取标签，再选择目标版本。</p>'}</section>`;
}
export function versionPreview(delivery, esc, sha) {
  const labels = { internal: '保留内部版本', merge: '三方合并', upstream: '更新至目标版本' };
  const kinds = { added: '新增', deleted: '删除', modified: '修改' };
  return `<section class="card"><h3>本次版本接收范围 · ${esc(delivery.source.tag)}</h3><p>来源 ${sha(delivery.base.upstream)} → ${sha(delivery.target)}</p><p>冻结内部基线 ${sha(delivery.base.internal)}</p><details open><summary>上游文件变化（${delivery.preview.changes.length}）</summary><table><thead><tr><th>路径</th><th>变化</th><th>处理方式</th></tr></thead><tbody>${delivery.preview.changes.map((item) => `<tr><td>${esc(item.path)}</td><td>${kinds[item.kind]}</td><td>${labels[item.category]}</td></tr>`).join('')}</tbody></table></details><details><summary>内部差异（${delivery.preview.internalChanges.length}）</summary>${delivery.preview.internalChanges.map((item) => `<p>${esc(item.path)} · ${labels[item.category]}</p>`).join('')}</details></section>`;
}
export function conflictOptions(delivery, esc) {
  if (delivery.error?.code !== 'CONTENT_CONFLICT') return '';
  return `<section class="card" id="conflict-options"><h3>解决共同文件冲突</h3><p>候选尚未推送。逐个选择版本或保存人工合并内容，完成后再检查与推送。</p>${delivery.error.details.paths.map((path) => `<p>× ${esc(path)} <button type="button" data-conflict-path="${esc(path)}">查看并处理冲突</button></p>`).join('')}<div id="conflict-editor"></div></section>`;
}
export function conflictEditor(result, esc) {
  return `<h3>${esc(result.path)}</h3><div class="split"><details open><summary>内部版本</summary><pre>${esc(result.internal)}</pre></details><details open><summary>上游版本</summary><pre>${esc(result.upstream)}</pre></details></div><details><summary>上次同步基线</summary><pre>${esc(result.base)}</pre></details><form data-form="resolve"><input type="hidden" name="path" value="${esc(result.path)}"><label>处理方式<select name="choice"><option value="internal">保留内部版本（含内部删除）</option><option value="upstream">采用上游版本（含上游删除）</option>${result.editable ? '<option value="manual">保存人工合并内容</option>' : ''}</select></label>${result.editable ? `<label>人工合并后的完整内容<textarea name="content" rows="10">${esc(result.internal)}</textarea></label>` : '<p>此文件不适合在线文本编辑，可选择一侧版本。</p>'}<button class="primary" type="submit">保存此冲突处理结果</button></form>`;
}

function lockedRules(config, esc) {
  if (config.mode !== 'version') return '';
  return `<p>内部保留：${esc(config.internalPaths.join('、') || '无')}</p><p>共同修改：${esc(config.mergePaths.join('、') || '无')}</p>`;
}
