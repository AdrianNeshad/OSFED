import { Construction } from 'lucide-react';
import { EmptyState } from '../components/ui';

export default function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <div className="h-full">
      <EmptyState icon={<Construction size={40} />} title={title}>
        {note || 'This view is wired to the engine and will populate once content extraction for this data type is enabled.'}
      </EmptyState>
    </div>
  );
}
