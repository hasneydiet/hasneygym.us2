'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthCoach } from '@/components/providers/AuthCoachProvider';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { loading, user } = useAuthCoach();

  // Centralized auth: only redirect when the provider has finished initializing.
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    // During the redirect frame, keep layout stable.
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Redirecting...</div>
      </div>
    );
  }

  return <>{children}</>;
}
