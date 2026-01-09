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
    };

    checkAuth();
  }, [router, isCoach, ready]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-lg">Loading...</div>
    </div>
  );
}
