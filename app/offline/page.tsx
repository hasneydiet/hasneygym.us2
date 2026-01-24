export const dynamic = 'force-static';

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm w-full rounded-xl border border-border bg-card p-6 text-center">
        <div className="text-lg font-semibold text-foreground">You’re offline</div>
        <p className="mt-2 text-sm text-muted-foreground">
          Some features may be unavailable. Reconnect to sync your workouts.
        </p>
      </div>
    </div>
  );
}
