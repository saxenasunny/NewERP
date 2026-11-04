export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`bg-surface-muted animate-pulse rounded-md ${className}`} />
  );
}
