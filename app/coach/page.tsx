'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

type CoachUserRow = {
  id: string;
  email: string | null;
  created_at: string;
};

export default function CoachPage() {
  const router = useRouter();
  const { isCoach, setImpersonateUserId } = useCoach();
  const [users, setUsers] = useState<CoachUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCoach) return;
    const load = async () => {
      setLoading(true);
      setError(null);

      const { data, error } = await supabase.rpc('coach_list_users');
      if (error) {
        setError(error.message || 'Failed to load users.');
        setUsers([]);
      } else {
        setUsers((data || []) as CoachUserRow[]);
      }
      setLoading(false);
    };

    load();
  }, [isCoach]);

  useEffect(() => {
    // Client-side guard (DB enforces the real authorization).
    if (isCoach === false) {
      router.replace('/history');
    }
  }, [isCoach, router]);

  const handleOpenUser = (userId: string) => {
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
                    <Button onClick={() => handleOpenUser(u.id)} className="shrink-0">
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
