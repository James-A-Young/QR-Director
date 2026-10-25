import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { Card, EmptyState } from '../components/ui';

export function NotFoundPage() {
  return (
    <Card>
      <EmptyState
        icon={<Compass className="size-5" />}
        title="Page not found"
        description="The page you were looking for does not exist."
        action={<Link to="/" className="text-sm font-medium text-accent hover:underline">Back to dashboard</Link>}
      />
    </Card>
  );
}
