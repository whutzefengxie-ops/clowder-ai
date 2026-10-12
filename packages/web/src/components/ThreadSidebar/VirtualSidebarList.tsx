import {
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { VirtualThreadListHandle } from './VirtualThreadList';

function offsetTopWithin(element: HTMLElement, container: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = element;
  while (current && current !== container) {
    top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}
function topInset(container: HTMLElement): number {
  const occluder = container.querySelector<HTMLElement>('[data-scroll-occluder="true"]');
  if (!occluder) return 0;
  const rect = occluder.getBoundingClientRect(),
    top = container.getBoundingClientRect().top;
  return rect.top <= top + 2 && rect.bottom > top ? rect.bottom - top : 0;
}

/** Classic keeps its fixed slots. V2 measures content, including wrapped titles, signals and groups. */
export function VirtualSidebarList<T>({
  items,
  itemKey,
  renderItem,
  scrollContainerRef,
  handleRef,
  testId,
  measured,
}: {
  items: T[];
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  scrollContainerRef: RefObject<HTMLDivElement>;
  handleRef: Ref<VirtualThreadListHandle>;
  testId: string;
  measured: boolean;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [revision, setRevision] = useState(0);
  const [viewport, setViewport] = useState({ top: 0, height: 640 });
  // biome-ignore lint/correctness/useExhaustiveDependencies: revision invalidates the measured-height ref.
  const offsets = useMemo(() => {
    const result = [0];
    for (const item of items)
      result.push(result[result.length - 1] + (measured ? (heights.current.get(itemKey(item)) ?? 64) : 80));
    return result;
  }, [items, itemKey, measured, revision]);
  const updateViewport = useCallback(() => {
    const container = scrollContainerRef.current,
      list = listRef.current;
    if (!container || !list) return;
    const next = {
      top: Math.max(0, container.scrollTop - offsetTopWithin(list, container)),
      height: container.clientHeight || 640,
    };
    setViewport((old) => (old.top === next.top && old.height === next.height ? old : next));
  }, [scrollContainerRef]);
  useLayoutEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    updateViewport();
    container.addEventListener('scroll', updateViewport, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateViewport);
    observer?.observe(container);
    window.addEventListener('resize', updateViewport);
    return () => {
      container.removeEventListener('scroll', updateViewport);
      observer?.disconnect();
      window.removeEventListener('resize', updateViewport);
    };
  }, [scrollContainerRef, updateViewport]);
  const first = offsets.findIndex((bottom, i) => i > 0 && bottom > viewport.top);
  const last = offsets.findIndex((top) => top >= viewport.top + viewport.height);
  const start = Math.max(0, (first < 0 ? items.length : first - 1) - 5);
  const end = Math.min(items.length, (last < 0 ? items.length : last) + 5);
  // biome-ignore lint/correctness/useExhaustiveDependencies: items/range replace the observed DOM nodes.
  useLayoutEffect(() => {
    if (!measured || !listRef.current) return;
    const nodes = [...listRef.current.querySelectorAll<HTMLElement>('[data-virtual-row-key]')];
    const measure = () => {
      let changed = false;
      for (const node of nodes) {
        const key = node.dataset.virtualRowKey;
        if (!key) continue;
        const height = Math.ceil(node.getBoundingClientRect().height);
        if (height > 0 && heights.current.get(key) !== height) {
          heights.current.set(key, height);
          changed = true;
        }
      }
      if (changed) setRevision((value) => value + 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const node of nodes) observer?.observe(node);
    return () => observer?.disconnect();
  }, [measured, items, start, end]);
  useImperativeHandle(
    handleRef,
    () => ({
      scrollToIndex(index) {
        const container = scrollContainerRef.current,
          list = listRef.current;
        if (!container || !list || index < 0 || index >= items.length) return;
        container.scrollTop = Math.max(
          0,
          offsetTopWithin(list, container) +
            (offsets[index] + offsets[index + 1]) / 2 -
            (container.clientHeight || 640) / 2,
        );
        updateViewport();
      },
      ensureIndexVisible(index) {
        const container = scrollContainerRef.current,
          list = listRef.current;
        if (!container || !list || index < 0 || index >= items.length) return;
        const listTop = offsetTopWithin(list, container),
          rowTop = listTop + offsets[index],
          rowBottom = listTop + offsets[index + 1];
        const inset = topInset(container),
          bottom = container.scrollTop + (container.clientHeight || 640);
        if (rowTop < container.scrollTop + inset) container.scrollTop = Math.max(0, rowTop - inset);
        else if (rowBottom > bottom) container.scrollTop = rowBottom - (container.clientHeight || 640);
        updateViewport();
      },
    }),
    [items.length, offsets, scrollContainerRef, updateViewport],
  );
  return (
    <div
      ref={listRef}
      className="relative"
      style={{ height: offsets[items.length] }}
      data-testid={testId}
      data-rendered-count={end - start}
    >
      {items.slice(start, end).map((item, offset) => (
        <div
          key={itemKey(item)}
          data-virtual-row-key={itemKey(item)}
          className="absolute inset-x-0 flow-root"
          style={{ top: offsets[start + offset], ...(measured ? {} : { height: 80 }) }}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
