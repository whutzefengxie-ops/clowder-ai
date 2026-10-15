import { useState } from 'react';
import type { NativeLoginState } from './native-login-state';

const chinese = (zh: string) => zh;
export function KimiLoginHelp({
  readiness,
  t = chinese,
}: {
  readiness: NativeLoginState;
  t?: (zh: string, en: string) => string;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <div role="status" className="rounded-lg bg-conn-amber-bg p-3 text-sm text-conn-amber-text">
      <p className="font-medium">{t('Kimi 登录状态尚未验证', 'Kimi sign-in has not been verified')}</p>
      <p className="mt-1">
        {t(
          '暂无法只读校验 Kimi 登录。安装或配置存在不代表能够回复；可先发消息验证，若认证失败，请在本安装实例重新登录。',
          'Kimi sign-in cannot currently be checked without a request. Installation or configuration does not verify replies. Try a message; if authentication fails, sign in again for this installation.',
        )}
      </p>
      {readiness.loginCommand && (
        <details className="mt-2">
          <summary className="cursor-pointer">
            {t('本安装实例的登录命令', 'Sign-in command for this installation')} ·{' '}
            {readiness.loginShell === 'powershell' ? 'PowerShell' : 'Shell'}
          </summary>
          <p className="mt-2">
            {t(
              '复制到终端执行。命令会使用此实例的 HOME；直接在普通终端运行 kimi login 可能登录到其他环境。',
              'Copy this into a terminal. It uses this installation’s HOME; a plain kimi login may sign in to a different environment.',
            )}
          </p>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre rounded bg-cafe-surface p-3 text-xs">
            <code>{readiness.loginCommand}</code>
          </pre>
          <button
            type="button"
            className="mt-1 min-h-10 text-cafe-accent"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(readiness.loginCommand ?? '');
                setCopyState('copied');
              } catch {
                setCopyState('failed');
              }
            }}
          >
            {copyState === 'copied'
              ? t('已复制', 'Copied')
              : copyState === 'failed'
                ? t('请手动复制上方命令', 'Copy the command above manually')
                : t('复制登录命令', 'Copy sign-in command')}
          </button>
        </details>
      )}
    </div>
  );
}
