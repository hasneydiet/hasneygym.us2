'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Button } from '@/components/ui/button';
import { COACH_IMPERSONATE_EMAIL_KEY } from '@/lib/coach';
import { cacheGet, cacheSet } from '@/lib/perfCache';

export const dynamic = 'force-dynamic';

type CoachUserRow = {
  id: string;
  email: string | null;
};

export default function CoachPage() {
  const router = useRouter();
  const { isCoach, ready, setImpersonateUserId } = useCoach();
  const [users, setUsers] = useState<CoachUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getAccessToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  };

  useEffect(() => {
    if (!isCoach) return;

    const cacheKey = 'coach:users:v1';
    const cached = cacheGet<CoachUserRow[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      setUsers(cached);
      setLoading(false);
    }

    const load = async (silent?: boolean) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      const token = await getAccessToken();
      if (!token) {
        setError('No session token found.');
        setUsers([]);
        if (!silent) setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/coach/users', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(json?.error || 'Failed to load users.');
          setUsers([]);
        } else {
          const rows = (json?.users || []) as CoachUserRow[];
          setUsers(rows);
          cacheSet(cacheKey, rows, 30 * 1000);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load users.');
        setUsers([]);
      }

      if (!silent) setLoading(false);
    };

    if (cached && Array.isArray(cached) && cached.length) {
      const w = typeof window !== 'undefined' ? (window as any) : null;
      const refresh = () => load(true);
      if (w && typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(refresh, { timeout: 1200 });
      } else {
        setTimeout(refresh, 250);
      }
    } else {
      load(false);
    }
  }, [isCoach]);

  useEffect(() => {
    if (ready && isCoach === false) {
      router.replace('/history');
    }
  }, [ready, isCoach, router]);

  const handleOpenUser = (userId: string, email: string | null) => {
    if (typeof window !== 'undefined') {
      if (email) window.localStorage.setItem(COACH_IMPERSONATE_EMAIL_KEY, email);
      else window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
    }
    setImpersonateUserId(userId);
    router.push('/history');
  };

  return (
    <AuthGuard>
      <Navigation />
      <main className="page">
        <div className="page-container">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="page-title">Coach</h1>
              <p className="page-subtitle mt-1">Select a user to view and edit their workouts and routines.</p>
            </div>
          </div>

          <div className="surface p-6 sm:p-7">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : users.length === 0 ? (
              <div className="text-sm text-muted-foreground">No users found.</div>
            ) : (
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{u.email || u.id}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.id}</div>
                    </div>
                    <Button onClick={() => handleOpenUser(u.id, u.email)} className="shrink-0">
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}
