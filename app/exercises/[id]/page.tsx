'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Exercise, WorkoutSet } from '@/lib/types';
import { computeExerciseMetrics } from '@/lib/progressUtils';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

interface SessionMetrics {
  sessionId: string;
  date: string;
  volume: number;
  bestSet: string;
  est1RM: number;
}

export default function ExerciseProgressPage() {
  const params = useParams();
  const router = useRouter();
  const exerciseId = params.id as string;

  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [sessions, setSessions] = useState<SessionMetrics[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProgress();
  }, [exerciseId]);

  const loadProgress = async () => {
    const { data: exData } = await supabase
      .from('exercises')
      .select('*')
      .eq('id', exerciseId)
      .single();

    if (exData) {
      setExercise(exData);
    }

    const { data: workoutExercises } = await supabase
      .from('workout_exercises')
      .select('id, workout_session_id, workout_sessions!inner(started_at)')
      .eq('exercise_id', exerciseId)
      .order('workout_sessions(started_at)', { ascending: false })
      .limit(10);

    if (workoutExercises && workoutExercises.length > 0) {
      const metricsPromises = workoutExercises.map(async (we) => {
        const { data: setsData } = await supabase
          .from('workout_sets')
          .select('*')
          .eq('workout_exercise_id', we.id);

        const metrics = computeExerciseMetrics(setsData || []);
        return {
          sessionId: we.workout_session_id,
          date: (we as any).workout_sessions.started_at,
          ...metrics,
        };
      });

      const metricsData = await Promise.all(metricsPromises);
      setSessions(metricsData);
    }

    setLoading(false);
  };

  const lastSession = sessions[0];
  const previousSession = sessions[1];

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <button
            onClick={() => router.push('/exercises')}
            className="flex items-center space-x-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Exercises</span>
          </button>

          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-6">
            {exercise?.name || 'Exercise Progress'}
          </h1>

          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Loading...</p>
          ) : sessions.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No workout history for this exercise yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {lastSession && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6">
                    <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Last Session</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                      {format(new Date(lastSession.date), 'MMM d, yyyy')}
                    </p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Best Set:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{lastSession.bestSet}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Volume:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{lastSession.volume} kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Est 1RM:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {lastSession.est1RM > 0 ? `${lastSession.est1RM} kg` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {previousSession && (
                  <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6">
                    <h2 className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Previous Session</h2>
                    <p className="text-xs text-gray-500 dark:text-gray-500 mb-3">
                      {format(new Date(previousSession.date), 'MMM d, yyyy')}
                    </p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Best Set:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{previousSession.bestSet}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Volume:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{previousSession.volume} kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-gray-700 dark:text-gray-300">Est 1RM:</span>
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {previousSession.est1RM > 0 ? `${previousSession.est1RM} kg` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm overflow-hidden">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 p-6 pb-4">Session History</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Date</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Best Set</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Volume</th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Est 1RM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {sessions.map((session, idx) => (
                        <tr key={idx} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                            {format(new Date(session.date), 'MMM d, yyyy')}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{session.bestSet}</td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">{session.volume} kg</td>
                          <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                            {session.est1RM > 0 ? `${session.est1RM} kg` : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
