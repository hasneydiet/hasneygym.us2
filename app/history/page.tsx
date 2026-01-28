'use client';

import { useEffect, useState, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { getSupabaseClient } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { WorkoutSession } from '@/lib/types';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cacheGet, cacheSet } from '@/lib/perfCache';

export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  const router = useRouter();
  const { effectiveUserId } = useCoach();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fast path: show cached history immediately when switching tabs.
    if (!effectiveUserId) return;
    const cacheKey = `history:sessions:${effectiveUserId}:v1`;
    const cached = cacheGet<WorkoutSession[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      setSessions(cached);
      setLoading(false);
      const w = typeof window !== 'undefined' ? (window as any) : null;
      const refresh = () => loadSessions({ cacheKey, silent: true });
      if (w && typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(refresh, { timeout: 1200 });
      } else {
        setTimeout(refresh, 250);
      }
      return;
    }

    loadSessions({ cacheKey });
  }, [effectiveUserId]);

  const loadSessions = async (opts?: { cacheKey?: string; silent?: boolean }) => {
    if (!effectiveUserId) return;
    const cacheKey = opts?.cacheKey || `history:sessions:${effectiveUserId}:v1`;
    if (!opts?.silent) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('*, routines(name), routine_days(name)')
      .eq('user_id', effectiveUserId)
        .order('started_at', { ascending: false });

      if (error) throw error;
      setSessions(data || []);
      cacheSet(cacheKey, (data || []) as any, 20 * 1000);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (sessionId: string, e: MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Delete this workout session? This cannot be undone.')) return;

    const { data: workoutExercises } = await supabase
      .from('workout_exercises')
      .select('id')
      .eq('workout_session_id', sessionId);

    if (workoutExercises && workoutExercises.length > 0) {
      const exerciseIds = workoutExercises.map(e => e.id);
      await supabase
        .from('workout_sets')
        .delete()
        .in('workout_exercise_id', exerciseIds);
    }

    await supabase
      .from('workout_exercises')
      .delete()
      .eq('workout_session_id', sessionId);

    await supabase
      .from('workout_sessions')
      .delete()
      .eq('id', sessionId);

    loadSessions();
  };

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page max-w-4xl">
          <h1 className="page-title mb-2">History</h1>
          <p className="page-subtitle mb-6">Your completed and in-progress workouts.</p>

          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : sessions.length === 0 ? (
            <div className="surface p-12 text-center text-muted-foreground">No workout history yet.</div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="surface surface-hover p-4 flex items-start justify-between"
                >
                  <button
                    onClick={() => router.push(`/history/${session.id}`)}
                    className="flex-1 text-left"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-base sm:text-lg font-semibold tracking-tight">
                          {session.routines?.name || 'Quick Workout'}
                        </h3>
                        {session.routine_days?.name && (
                          <p className="text-sm text-muted-foreground">{session.routine_days.name}</p>
                        )}
                        <p className="text-xs text-muted-foreground/80 mt-1">
                          {format(new Date(session.started_at), 'MMM d, yyyy • h:mm a')}
                          {session.ended_at && (
                            <> - {format(new Date(session.ended_at), 'h:mm a')}</>
                          )}
                        </p>
                      </div>
                      {!session.ended_at && (
                        <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                          Active
                        </Badge>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    className="icon-btn ml-2 text-destructive hover:text-destructive"
                    aria-label="Delete workout session"
                    title="Delete"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
