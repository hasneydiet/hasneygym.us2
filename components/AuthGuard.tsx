'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient } from '@/lib/supabase';

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;

    const init = async () => {
      try {
        const supabase = await getSupabaseClient();

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (cancelled) return;

        if (!session) {
          router.push('/login');
          return;
        }

        setLoading(false);

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((_event, s) => {
          if (!s) {
            router.push('/login');
          }
        });

        unsubscribe = () => subscription.unsubscribe();
      } catch {
        // If supabase client is misconfigured, send user to login.
        router.push('/login');
      }
    };

    init();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return <>{children}</>;
}
