import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** One sentence saying what goes here. */
  body: string;
  action?: { label: string; onClick: () => void };
  tone?: 'normal' | 'alert';
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon: Icon, title, body, action, tone = 'normal' }) => (
  <div className="empty">
    <div className="empty-icon" style={tone === 'alert' ? { background: 'var(--accs)', color: 'var(--acc)' } : undefined}>
      <Icon aria-hidden />
    </div>
    <b>{title}</b>
    <p>{body}</p>
    {action && <button className="btn btn-pri" onClick={action.onClick}>{action.label}</button>}
  </div>
);

/** Error block with a retry button, used wherever a Supabase read fails. */
export const LoadError: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div className="empty" role="alert">
    <b>Something went wrong</b>
    <p>{message}</p>
    <button className="btn" onClick={onRetry}>Try again</button>
  </div>
);

export default EmptyState;
