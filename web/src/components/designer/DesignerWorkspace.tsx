import type { ReactNode } from 'react';
import type { QrStyle, Template } from '../../lib/types';
import { Card } from '../ui';
import { QrDesigner } from './QrDesigner';
import { QrPreview } from './QrPreview';

/** Two-column editor: controls on the left, a sticky live preview (plus extras) on the right. */
export function DesignerWorkspace({
  style,
  onChange,
  templates,
  linkId,
  aside,
}: {
  style: QrStyle;
  onChange: (s: QrStyle) => void;
  templates?: Template[];
  linkId?: string;
  aside?: ReactNode;
}) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <Card className="order-2 overflow-hidden lg:order-1">
        <QrDesigner value={style} onChange={onChange} templates={templates} />
      </Card>
      <div className="order-1 space-y-4 lg:sticky lg:top-6 lg:order-2">
        <Card className="p-4">
          <QrPreview style={style} linkId={linkId} />
        </Card>
        {aside}
      </div>
    </div>
  );
}
