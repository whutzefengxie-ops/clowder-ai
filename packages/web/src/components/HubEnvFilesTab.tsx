'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/utils/api-client';

interface EnvVar {
  name: string;
  defaultValue: string;
  description: string;
  category: string;
  sensitive: boolean;
  currentValue: string | null;
}

interface DataDirs {
  auditLogs: string;
  cliArchive: string;
  redisDevSandbox: string;
  uploads: string;
}

interface EnvPaths {
  projectRoot: string;
  homeDir: string;
  dataDirs: DataDirs;
}

interface EnvSummaryData {
  categories: Record<string, string>;
  variables: EnvVar[];
  paths: EnvPaths;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-gray-50/70 p-3">
      <h3 className="text-xs font-semibold text-gray-700 mb-2">{title}</h3>
      {children}
    </section>
  );
}

function VscodeLink({ path, label }: { path: string; label: string }) {
  return (
    <a
      href={`vscode://file${path}`}
      className="text-blue-600 hover:text-blue-800 underline text-xs truncate block"
      title={path}
    >
      {label}
    </a>
  );
}

function buildConfigFiles(projectRoot: string) {
  return [
    { name: 'cat-template.json', path: `${projectRoot}/cat-template.json`, desc: '猫猫模板（只读 seed）' },
    { name: '.cat-cafe/cat-catalog.json', path: `${projectRoot}/.cat-cafe/cat-catalog.json`, desc: '运行时成员真相源' },
    { name: '.env.local', path: `${projectRoot}/.env.local`, desc: '本地环境变量覆盖' },
    { name: 'start-dev.sh', path: `${projectRoot}/scripts/start-dev.sh`, desc: '开发启动脚本' },
    { name: 'CLAUDE.md', path: `${projectRoot}/CLAUDE.md`, desc: '布偶猫项目指引' },
    { name: 'AGENTS.md', path: `${projectRoot}/AGENTS.md`, desc: '缅因猫项目指引' },
    { name: 'GEMINI.md', path: `${projectRoot}/GEMINI.md`, desc: '暹罗猫项目指引' },
  ];
}

function buildDataDirs(dataDirs: DataDirs) {
  return [
    { name: '审计日志', path: dataDirs.auditLogs, desc: 'EventAuditLog 输出' },
    { name: 'CLI 归档', path: dataDirs.cliArchive, desc: 'CLI 原始输出归档' },
    { name: 'Redis 开发沙盒', path: dataDirs.redisDevSandbox, desc: '开发用 Redis 数据' },
    { name: '上传目录', path: dataDirs.uploads, desc: '文件上传存储' },
  ];
}

function ConfigFilesSection({ projectRoot }: { projectRoot: string }) {
  const files = buildConfigFiles(projectRoot);
  return (
    <Section title="配置文件">
      <div className="space-y-2">
        {files.map((f) => (
          <div key={f.name} className="flex items-baseline gap-2">
            <code className="text-xs font-mono text-gray-700 bg-gray-200 px-1.5 py-0.5 rounded shrink-0">{f.name}</code>
            <span className="text-xs text-gray-500">{f.desc}</span>
            <VscodeLink path={f.path} label="打开" />
          </div>
        ))}
      </div>
    </Section>
  );
}

function EnvVarsSection({ categories, variables }: { categories: Record<string, string>; variables: EnvVar[] }) {
  const grouped = Object.entries(categories)
    .map(([key, label]) => ({
      key,
      label,
      vars: variables.filter((v) => v.category === key),
    }))
    .filter((g) => g.vars.length > 0);

  return (
    <Section title="环境变量">
      <div className="space-y-3">
        {grouped.map((group) => (
          <div key={group.key}>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{group.label}</p>
            <div className="space-y-1">
              {group.vars.map((v) => (
                <div key={v.name} className="grid grid-cols-[1fr_auto_auto] gap-x-3 items-baseline text-xs">
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <code className="font-mono text-gray-700 shrink-0">{v.name}</code>
                    <span className="text-gray-400 truncate">{v.description}</span>
                  </div>
                  <span className="text-gray-400 text-[11px]">默认: {v.defaultValue}</span>
                  <span className={`font-mono text-[11px] ${v.currentValue ? 'text-green-600' : 'text-gray-300'}`}>
                    {v.currentValue ?? '未设置'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function DataDirsSection({ dataDirs }: { dataDirs: DataDirs }) {
  const dirs = buildDataDirs(dataDirs);
  return (
    <Section title="数据目录">
      <div className="space-y-2">
        {dirs.map((d) => (
          <div key={d.name} className="flex items-baseline gap-2">
            <span className="text-xs text-gray-700 font-medium shrink-0">{d.name}</span>
            <span className="text-xs text-gray-500">{d.desc}</span>
            <VscodeLink path={d.path} label="打开" />
          </div>
        ))}
      </div>
    </Section>
  );
}

export function HubEnvFilesTab() {
  const [data, setData] = useState<EnvSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/api/config/env-summary')
      .then(async (res) => {
        if (res.ok) setData((await res.json()) as EnvSummaryData);
        else setError('环境信息加载失败');
      })
      .catch(() => setError('环境信息加载失败'));
  }, []);

  if (error) return <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>;
  if (!data) return <p className="text-sm text-gray-400">加载中...</p>;

  return (
    <>
      <ConfigFilesSection projectRoot={data.paths.projectRoot} />
      <EnvVarsSection categories={data.categories} variables={data.variables} />
      <DataDirsSection dataDirs={data.paths.dataDirs} />
    </>
  );
}
