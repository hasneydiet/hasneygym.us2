'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';

export const dynamic = 'force-dynamic';

export default function Home() {
  const router = useRouter();
  const { isCoach, ready } = useCoach();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // If Supabase env vars are missing/misconfigured, this call can throw.
        // Never allow the app to get stuck on an infinite Loading screen.
        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          router.replace('/login');
          return;
        }

        // Wait until coach detection is ready to avoid briefly routing coaches into workout.
        if (!ready) return;

        if (isCoach) {
          router.replace('/coach');
        } else {
          router.replace('/workout/start');
        }
      } catch {
        // Fail-safe: route to login if anything unexpected happens.
        router.replace('/login');
      }
    };

    checkAuth();
  }, [router, isCoach, ready]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-lg">Loading...</div>
    </div>
  );
}
