import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetOwnerConfigCacheForTest, useOwnerConfig } from '@/hooks/useOwnerConfig';
import { apiFetch } from '@/utils/api-client';

vi.mock('@/utils/api-client', () => ({
  apiFetch: vi.fn(),
}));

const mockApiFetch = vi.mocked(apiFetch);

function OwnerProbe() {
  const owner = useOwnerConfig();
  return React.createElement('span', null, owner.name);
}

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('useOwnerConfig', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    resetOwnerConfigCacheForTest();
    mockApiFetch.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetOwnerConfigCacheForTest();
  });

  afterAll(() => {
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('retries fetching owner config after a transient /api/config failure on the next mount', async () => {
    mockApiFetch.mockResolvedValueOnce({ ok: false } as Response);

    act(() => {
      root.render(React.createElement(OwnerProbe));
    });
    await act(async () => {
      await flushEffects();
    });

    expect(container.textContent).toBe('ME');
    expect(mockApiFetch).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);

    mockApiFetch.mockResolvedValueOnce({
      ok: true,
      json: vi.fn().mockResolvedValue({
        config: {
          owner: {
            name: 'Recovered Owner',
            aliases: ['Co-worker'],
            mentionPatterns: ['@owner'],
            color: {
              primary: '#123456',
              secondary: '#abcdef',
            },
          },
        },
      }),
    } as unknown as Response);

    act(() => {
      root.render(React.createElement(OwnerProbe));
    });
    await act(async () => {
      await flushEffects();
    });

    expect(mockApiFetch).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe('Recovered Owner');
  });
});
