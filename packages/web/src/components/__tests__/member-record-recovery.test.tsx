import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CatData } from '@/hooks/useCatData';
import { apiFetch } from '@/utils/api-client';
import { useMemberEditor } from '../settings/members/useMemberEditor';

vi.mock('@/utils/api-client', () => ({ API_URL: 'http://member-recovery.test', apiFetch: vi.fn() }));
let editor: ReturnType<typeof useMemberEditor>;
let root: Root;
let container: HTMLDivElement;
let stored: CatData | undefined;
let readsFail = false;
let writes = 0;
const saved = vi.fn(async () => {});
const existing = {
  id: 'recovery-member',
  name: 'Member',
  displayName: 'Member',
  avatar: '',
  clientId: 'openai',
  carrier: 'app_server',
  configurationSource: 'native_tool',
  defaultModel: '',
  roleDescription: '团队伙伴',
  personality: '',
  mentionPatterns: ['@recovery-member'],
  color: { primary: '#123456', secondary: '#abcdef' },
  configurationRevision: 'before',
} as CatData;
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function Harness({ member }: { member: CatData | null }) {
  editor = useMemberEditor(member, member ? [member] : [], saved);
  return (
    <button type="button" onClick={() => void editor.save()}>
      保存
    </button>
  );
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  saved.mockClear();
  stored = undefined;
  readsFail = false;
  writes = 0;
  vi.mocked(apiFetch).mockImplementation(async (path, init) => {
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      writes++;
      const payload = JSON.parse(String(init.body));
      stored = { ...existing, ...payload, configurationRevision: 'after' };
      throw new TypeError('response lost after commit');
    }
    if (path === '/api/cats')
      return readsFail ? response({ error: 'offline' }, 503) : response({ cats: stored ? [stored] : [] });
    if (path === '/api/accounts') return response({ projectPath: '/isolated', providers: [] });
    if (path === '/api/session') return response({ userId: 'owner' });
    if (path === '/api/cat-templates') return response({ templates: [] });
    return response({ cats: [] });
  });
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
});
async function render(member: CatData | null = null) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Harness member={member} />));
  if (!member) {
    await act(async () =>
      editor.switchRuntime({ id: 'codex', label: 'Codex', clientId: 'openai', installed: true, models: [] }),
    );
    await act(async () =>
      editor.patch({
        catId: 'recovery-member',
        name: 'Member',
        displayName: 'Member',
        mentionPatterns: '@recovery-member',
        roleDescription: '团队伙伴',
      }),
    );
  }
}

it('reads back a committed creation by stable catId after its response is lost', async () => {
  await render();
  await act(async () => editor.save());
  expect(editor.error).toBeNull();
  expect(editor.draft.baseline?.id).toBe('recovery-member');
  expect(saved).toHaveBeenCalledOnce();
  expect(writes).toBe(1);
});

it('keeps an unknown creation across remount and reconciles before another POST', async () => {
  await render();
  readsFail = true;
  await act(async () => editor.save());
  expect(editor.error).toBeTruthy();
  act(() => root.unmount());
  container.remove();
  await render();
  readsFail = false;
  expect(editor.draft.form).toEqual(editor.draft.pendingWrite?.form);
  await act(async () => editor.save());
  expect(writes).toBe(1);
  expect(editor.error).toBeNull();
  expect(editor.draft.baseline?.configurationRevision).toBe('after');
});

it('reads back a committed member PATCH without resending it', async () => {
  await render(existing);
  await act(async () => editor.patch({ personality: 'new personality' }));
  await act(async () => editor.save());
  expect(editor.error).toBeNull();
  expect(editor.draft.baseline?.personality).toBe('new personality');
  expect(writes).toBe(1);
});

it('preserves the draft when the pending catId belongs to a different configuration', async () => {
  await render();
  readsFail = true;
  await act(async () => editor.save());
  stored = { ...stored!, roleDescription: 'concurrent role' };
  readsFail = false;
  await act(async () => editor.save());
  expect(writes).toBe(1);
  expect(editor.error).toBeTruthy();
  expect(editor.draft.form.roleDescription).toBe('团队伙伴');
  expect(saved).not.toHaveBeenCalled();
});
