'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthCoach } from '@/components/providers/AuthCoachProvider';

export const dynamic = 'force-dynamic';

export default function Home() {
  const router = useRouter();
  const { loading, user, isCoach, coachReady } = useAuthCoach();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }

    // Prefer correct routing for coaches, but NEVER block indefinitely.
    // If coachReady isn't available yet, route to dashboard immediately and
    // allow a later redirect once coach status resolves.
    if (coachReady) {
      router.replace(isCoach ? '/coach' : '/dashboard');
      return;
    }

    router.replace('/dashboard');
  }, [router, loading, user, isCoach, coachReady]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-lg">Loading...</div>
    </div>
  );
}
