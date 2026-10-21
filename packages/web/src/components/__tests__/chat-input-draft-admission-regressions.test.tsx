import type { ContextAttachment } from '@cat-cafe/shared';
import { act, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { prepareComposerDraftAdmission } from '@/components/composer-draft-flush-registry';
import { threadContextAttachmentDrafts, threadImageDrafts } from '@/components/thread-drafts';
import { useDurableComposerDraft } from '@/components/useDurableComposerDraft';
import { useChatStore } from '@/stores/chatStore';
import { apiFetch } from '@/utils/api-client';

vi.mock('@/utils/api-client', () => ({ apiFetch: vi.fn() }));
const THREAD = 'review-1657-r2';
let root: Root;
let container: HTMLDivElement;
let owner: { text: string } | null;
let revision: number;
let writes: { text?: string; expectedRevision: number }[];
let write: (body: { text?: string; expectedRevision: number }, method: string) => Response | Promise<Response>;
let typeText: (text: string) => void;
let addFiles: (files: File[]) => void;
let updateAttachments: (attachments: ContextAttachment[]) => void;
let beginAndClear: () => void;
let finish: (accepted: boolean | undefined) => void;
let resolvePendingWrite: (() => void) | null;
const preparing = () => {};
const response = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function Harness({ threadId = THREAD }: { threadId?: string }) {
  const [input, setInput] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [attachments, setAttachments] = useState<ContextAttachment[]>([]);
  const replyToMessage = useChatStore((state) => state.replyToMessage);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const durable = useDurableComposerDraft({
    threadId,
    input,
    setInput,
    images,
    setImages,
    contextAttachments: attachments,
    setContextAttachments: setAttachments,
    replyToMessage,
    textareaRef,
    setIsPreparingImages: preparing,
  });
  typeText = setInput;
  addFiles = setImages;
  updateAttachments = setAttachments;
  beginAndClear = () => {
    finish = durable.beginAdmission({ text: input, images, contextAttachments: attachments, replyTo: replyToMessage });
    durable.markOptimisticallyCleared();
    setInput('');
    setImages([]);
    setAttachments([]);
    useChatStore.getState().clearReplyTo();
  };
  return (
    <>
      <textarea ref={textareaRef} value={input} readOnly />
      <span data-files>{images.length}</span>
      <span data-context>{JSON.stringify(attachments)}</span>
    </>
  );
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  });
}
async function render() {
  await act(async () => root.render(<Harness />));
  await settle();
  expect(container.querySelector('textarea')?.value).toBe('old saved draft');
}
async function admissionResult() {
  let result: unknown;
  await act(async () => {
    try {
      result = await prepareComposerDraftAdmission(THREAD);
    } catch (error) {
      result = error;
    }
  });
  return result;
}
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  threadImageDrafts.clear();
  threadContextAttachmentDrafts.clear();
  useChatStore.setState({ currentThreadId: THREAD, pendingChatInsert: null, replyToMessage: null });
  owner = { text: 'old saved draft' };
  revision = 5;
  writes = [];
  resolvePendingWrite = null;
  write = (body, method) => {
    expect(body.expectedRevision).toBe(revision);
    owner = method === 'DELETE' ? null : { text: body.text ?? '' };
    revision += 1;
    return response({ draft: owner, revision });
  };
  vi.mocked(apiFetch).mockImplementation(async (_url, init) => {
    if (init?.method) {
      const body = JSON.parse(String(init.body));
      writes.push(body);
      return await write(body, init.method);
    }
    return response({ draft: owner, revision });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  resolvePendingWrite?.();
  await settle();
  act(() => root.unmount());
  await settle();
  resolvePendingWrite?.(); // The unmount boundary can enqueue one final save.
  await settle();
  container.remove();
  vi.useRealTimers();
  vi.clearAllMocks();
  delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
});

it('admits an edit before the 400ms autosave without reintroducing old text', async () => {
  await render();
  act(() => typeText('new edited message'));
  act(() => beginAndClear());
  const result = await admissionResult();
  expect(result).toEqual({ threadId: THREAD, expectedRevision: 6 });
  expect(writes.at(-1)?.text).toBe('new edited message');
  act(() => finish(true));
});

it('keeps the attempted edit when the admission save fails', async () => {
  await render();
  act(() => typeText('new edited message'));
  write = () => response({ error: 'save failed' }, 500);
  act(() => beginAndClear());
  expect(await admissionResult()).toBeInstanceOf(Error);
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toBe('new edited message');
});

it('preserves new typing while an earlier admitted send is subsequently rejected', async () => {
  await render();
  act(() => typeText('attempted message'));
  await act(async () => vi.advanceTimersByTimeAsync(450));
  act(() => beginAndClear());
  expect(await admissionResult()).toEqual({ threadId: THREAD, expectedRevision: 6 });
  act(() => typeText('next message typed while waiting'));
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toContain('next message typed while waiting');
  expect(container.querySelector('textarea')?.value).toContain('attempted message');
});

it('preserves attempted text when a 409 exposes a different remote draft', async () => {
  await render();
  act(() => typeText('local attempted message'));
  write = () => {
    owner = { text: 'remote unsent message' };
    revision = 6;
    return response({ code: 'DRAFT_REVISION_MISMATCH' }, 409);
  };
  act(() => beginAndClear());
  expect(await admissionResult()).toBeInstanceOf(Error);
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toContain('local attempted message');
});

it('keeps local File attachments when a save is rejected', async () => {
  await render();
  act(() => addFiles([new File(['image'], 'local.png', { type: 'image/png' })]));
  act(() => typeText('new image message'));
  write = () => response({ error: 'save failed' }, 500);
  act(() => beginAndClear());
  expect(await admissionResult()).toBeInstanceOf(Error);
  act(() => finish(false));
  expect(container.querySelector('[data-files]')?.textContent).toBe('1');
});

it('does not mistake completion of its own in-flight autosave for foreign recovery', async () => {
  await render();
  write = (body, method) => {
    if (body.text === 'please inspect current PR') {
      return new Promise<Response>((resolve) => {
        resolvePendingWrite = () => {
          owner = { text: body.text ?? '' };
          revision = 6;
          resolve(response({ draft: owner, revision }));
          resolvePendingWrite = null;
        };
      });
    }
    owner = method === 'DELETE' ? null : { text: body.text ?? '' };
    revision += 1;
    return response({ draft: owner, revision });
  };
  act(() => typeText('please inspect current PR'));
  await act(async () => vi.advanceTimersByTimeAsync(400));
  expect(resolvePendingWrite).not.toBeNull();
  act(() => typeText('please revise current PR'));
  act(() => beginAndClear());
  resolvePendingWrite?.();
  await settle(); // The real send caller also has async mirror/intent work before preparation.
  const result = await admissionResult();
  act(() => finish(!(result instanceof Error)));
  expect(result).not.toBeInstanceOf(Error);
  expect(writes.findLast((body) => body.text)?.text).toBe('please revise current PR');
});

it('still requires confirmation and displays both drafts when hydration arrives after the click', async () => {
  let releaseRead: (value: Response) => void;
  const read = new Promise<Response>((resolve) => {
    releaseRead = resolve;
  });
  vi.mocked(apiFetch).mockImplementation(async (_url, init) => {
    if (!init?.method) return read;
    const body = JSON.parse(String(init.body));
    writes.push(body);
    return await write(body, init.method);
  });
  await act(async () => root.render(<Harness />));
  act(() => typeText('local attempted message'));
  let result: unknown;
  await act(async () => {
    beginAndClear();
    const preparingAdmission = prepareComposerDraftAdmission(THREAD).catch((error) => error);
    owner = { text: 'remote unsent message' };
    releaseRead(response({ draft: owner, revision }));
    result = await preparingAdmission;
  });
  expect(result).toBeInstanceOf(Error);
  expect((result as Error).name).toBe('ComposerDraftConfirmationRequiredError');
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toBe('remote unsent message\n\nlocal attempted message');
});

it('requires confirmation before a retry can overwrite an unseen draft fetched after a 409', async () => {
  await render();
  act(() => typeText('local attempted message'));
  let firstWrite = true;
  write = (body, method) => {
    if (firstWrite) {
      firstWrite = false;
      owner = { text: 'unseen remote draft' };
      revision = 6;
      return response({ code: 'DRAFT_REVISION_MISMATCH' }, 409);
    }
    owner = method === 'DELETE' ? null : { text: body.text ?? '' };
    revision += 1;
    return response({ draft: owner, revision });
  };
  act(() => beginAndClear());
  expect(await admissionResult()).toBeInstanceOf(Error);
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toBe('local attempted message');
  act(() => beginAndClear());
  const retry = await admissionResult();
  act(() => finish(false));
  expect(retry).toBeInstanceOf(Error);
  expect((retry as Error).name).toBe('ComposerDraftConfirmationRequiredError');
  expect(owner?.text).toContain('unseen remote draft');
});

it('preserves typing done while the merged recovery snapshot is being saved', async () => {
  let releaseRead: (value: Response) => void;
  const read = new Promise<Response>((resolve) => {
    releaseRead = resolve;
  });
  vi.mocked(apiFetch).mockImplementation(async (_url, init) => {
    if (!init?.method) return read;
    const body = JSON.parse(String(init.body));
    writes.push(body);
    return await write(body, init.method);
  });
  write = (body) =>
    new Promise<Response>((resolve) => {
      resolvePendingWrite = () => {
        owner = { text: body.text ?? '' };
        revision += 1;
        resolve(response({ draft: owner, revision }));
        resolvePendingWrite = null;
      };
    });
  await act(async () => root.render(<Harness />));
  act(() => typeText('local attempted message'));
  let preparingAdmission: Promise<unknown>;
  act(() => {
    beginAndClear();
    preparingAdmission = prepareComposerDraftAdmission(THREAD).catch((error) => error);
    owner = { text: 'remote unsent message' };
    releaseRead(response({ draft: owner, revision }));
  });
  await settle();
  expect(resolvePendingWrite).not.toBeNull();
  act(() => typeText('new typing while recovery save waits'));
  let result: unknown;
  await act(async () => {
    resolvePendingWrite?.();
    result = await preparingAdmission;
  });
  expect((result as Error).name).toBe('ComposerDraftConfirmationRequiredError');
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toContain('new typing while recovery save waits');
  expect(container.querySelector('textarea')?.value).toContain('local attempted message');
  expect(container.querySelector('textarea')?.value).toContain('remote unsent message');
});

it('does not restore an old-thread admission into the newly selected thread', async () => {
  await render();
  act(() => typeText('old-thread attempted message'));
  act(() => beginAndClear());
  const oldFinish = finish;
  owner = { text: 'new-thread saved draft' };
  revision = 20;
  await act(async () => {
    useChatStore.setState({ currentThreadId: 'new-thread' });
    root.render(<Harness threadId="new-thread" />);
  });
  await settle();
  act(() => typeText('new-thread current edit'));
  act(() => oldFinish(false));
  expect(container.querySelector('textarea')?.value).toBe('new-thread current edit');
});

it.each(['autosave', 'pagehide'])('does not let %s overwrite an unseen remote draft after a 409', async (boundary) => {
  await render();
  act(() => typeText('local attempted message'));
  let firstWrite = true;
  write = (body, method) => {
    if (firstWrite) {
      firstWrite = false;
      owner = { text: 'unseen remote draft' };
      revision = 6;
      return response({ code: 'DRAFT_REVISION_MISMATCH' }, 409);
    }
    owner = method === 'DELETE' ? null : { text: body.text ?? '' };
    revision += 1;
    return response({ draft: owner, revision });
  };
  act(() => beginAndClear());
  expect(await admissionResult()).toBeInstanceOf(Error);
  act(() => finish(false));
  expect(owner?.text).toBe('unseen remote draft');
  if (boundary === 'autosave') await act(async () => vi.advanceTimersByTimeAsync(450));
  else {
    act(() => window.dispatchEvent(new Event('pagehide')));
    await settle();
  }
  expect(owner?.text).toContain('unseen remote draft');
  expect(container.querySelector('textarea')?.value).toContain('local attempted message');
});

it('keeps autosaving the new thread after the old-thread admission finishes', async () => {
  await render();
  act(() => typeText('old-thread attempted message'));
  act(() => beginAndClear());
  const oldFinish = finish;
  owner = { text: 'new-thread saved draft' };
  revision = 20;
  await act(async () => {
    useChatStore.setState({ currentThreadId: 'new-thread' });
    root.render(<Harness threadId="new-thread" />);
  });
  await settle();
  act(() => typeText('new-thread current edit'));
  act(() => oldFinish(false));
  await act(async () => vi.advanceTimersByTimeAsync(450));
  expect(container.querySelector('textarea')?.value).toBe('new-thread current edit');
  expect(owner?.text).toBe('new-thread current edit');
});

it('preserves context and reply selected while the merged recovery snapshot is being saved', async () => {
  let releaseRead: (value: Response) => void;
  const read = new Promise<Response>((resolve) => {
    releaseRead = resolve;
  });
  vi.mocked(apiFetch).mockImplementation(async (_url, init) => {
    if (!init?.method) return read;
    const body = JSON.parse(String(init.body));
    writes.push(body);
    return await write(body, init.method);
  });
  write = (body) =>
    new Promise<Response>((resolve) => {
      resolvePendingWrite = () => {
        owner = { text: body.text ?? '' };
        revision += 1;
        resolve(response({ draft: owner, revision }));
        resolvePendingWrite = null;
      };
    });
  await act(async () => root.render(<Harness />));
  act(() => typeText('local attempted message'));
  let preparingAdmission: Promise<unknown>;
  act(() => {
    beginAndClear();
    preparingAdmission = prepareComposerDraftAdmission(THREAD).catch((error) => error);
    owner = { text: 'remote unsent message' };
    releaseRead(response({ draft: owner, revision }));
  });
  await settle();
  expect(resolvePendingWrite).not.toBeNull();
  const newContext: ContextAttachment = {
    v: 1,
    kind: 'thread',
    id: 'new-context',
    threadId: 'source-thread',
    title: 'New user selection',
  };
  act(() => {
    updateAttachments([newContext]);
    useChatStore.getState().setReplyTo({
      id: 'new-reply',
      content: 'New reply target',
      senderCatId: null,
      threadId: THREAD,
    });
  });
  let result: unknown;
  await act(async () => {
    resolvePendingWrite?.();
    result = await preparingAdmission;
  });
  expect((result as Error).name).toBe('ComposerDraftConfirmationRequiredError');
  act(() => finish(false));
  expect.soft(JSON.parse(container.querySelector('[data-context]')?.textContent ?? 'null')).toContainEqual(newContext);
  expect.soft(useChatStore.getState().replyToMessage?.id).toBe('new-reply');
});

it('restores the confirmed attempted edit when its confirming retry meets another 409', async () => {
  await render();
  act(() => typeText('local attempted message'));
  let count = 0;
  write = (body, method) => {
    count += 1;
    if (count === 1 || count === 3) {
      owner = { text: count === 1 ? 'first unseen remote draft' : 'newer unseen remote draft' };
      revision += 1;
      return response({ code: 'DRAFT_REVISION_MISMATCH' }, 409);
    }
    owner = method === 'DELETE' ? null : { text: body.text ?? '' };
    revision += 1;
    return response({ draft: owner, revision });
  };
  act(() => beginAndClear());
  expect(await admissionResult()).toBeInstanceOf(Error);
  act(() => finish(false));
  act(() => beginAndClear());
  const merged = await admissionResult();
  expect((merged as Error).name).toBe('ComposerDraftConfirmationRequiredError');
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toContain('first unseen remote draft');
  act(() => typeText('edited confirmed draft to send'));
  act(() => beginAndClear());
  expect(await admissionResult()).toBeInstanceOf(Error);
  act(() => finish(false));
  expect(container.querySelector('textarea')?.value).toContain('edited confirmed draft to send');
});
