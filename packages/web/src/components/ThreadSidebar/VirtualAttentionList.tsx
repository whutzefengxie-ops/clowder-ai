import { forwardRef, type ReactNode, type RefObject } from 'react';
import { useShellPresentation } from '../shell/shell-presentation';
import type { AttentionListRow } from './attention-clusters';
import { VirtualSidebarList } from './VirtualSidebarList';
import type { VirtualThreadListHandle } from './VirtualThreadList';

interface VirtualAttentionListProps {
  rows: AttentionListRow[];
  scrollContainerRef: RefObject<HTMLDivElement>;
  renderItem: (row: AttentionListRow) => ReactNode;
}
const itemKey = (item: AttentionListRow) => item.key;
export const VirtualAttentionList = forwardRef<VirtualThreadListHandle, VirtualAttentionListProps>(
  function VirtualAttentionList({ rows, scrollContainerRef, renderItem }, ref) {
    const measured = useShellPresentation() === 'v2';
    return (
      <VirtualSidebarList
        items={rows}
        itemKey={itemKey}
        renderItem={renderItem}
        scrollContainerRef={scrollContainerRef}
        handleRef={ref}
        measured={measured}
        testId="virtual-attention-list"
      />
    );
  },
);
