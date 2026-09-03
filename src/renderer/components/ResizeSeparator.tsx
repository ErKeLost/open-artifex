import { DotsThreeVertical } from '@phosphor-icons/react';
import { Separator } from 'react-resizable-panels';

export function ResizeSeparator({ id }: { id: string }) {
  return (
    <Separator aria-label="调整面板宽度" className="oa-resize-separator" id={id}>
      <span aria-hidden="true">
        <DotsThreeVertical size={12} weight="bold" />
      </span>
    </Separator>
  );
}

