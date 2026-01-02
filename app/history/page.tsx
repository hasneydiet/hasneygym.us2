'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { WorkoutSession } from '@/lib/types';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('*, routines(name), routine_days(name)')
        .order('started_at', { ascending: false });

      if (error) throw error;
      setSessions(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (sessionId: string, e: React.MouseEvent) => {
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
        <div className="page">
          <h1 className="page-title mb-6">History</h1>

          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Loading...</p>
          ) : sessions.length === 0 ? (
            <div className="surface p-12 text-center">
              <p className="text-gray-500 dark:text-gray-400">No workout history yet.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-4 hover:shadow-md transition-shadow flex items-start justify-between"
                >
                  <button
                    onClick={() => router.push(`/history/${session.id}`)}
                    className="flex-1 text-left"
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                          {session.routines?.name || 'Quick Workout'}
                        </h3>
                        {session.routine_days?.name && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">{session.routine_days.name}</p>
                        )}
                        <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                          {format(new Date(session.started_at), 'MMM d, yyyy • h:mm a')}
                          {session.ended_at && (
                            <> - {format(new Date(session.ended_at), 'h:mm a')}</>
                          )}
                        </p>
                      </div>
                      {!session.ended_at && (
                        <span className="bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs px-2 py-1 rounded-full">
                          Active
                        </span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={(e) => deleteSession(session.id, e)}
                    className="icon-btn text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
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
