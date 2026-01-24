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
import { Button } from '@/components/ui/button';

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
      <div className="app-shell">
        <Navigation />
        <div className="page max-w-7xl">
          <Button
            onClick={() => router.push('/exercises')}
            variant="outline"
            className="w-fit gap-2 mb-4"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back to Exercises</span>
          </Button>

          <h1 className="page-title mb-6">
            {exercise?.name || 'Exercise Progress'}
          </h1>

          {loading ? (
            <p className="text-muted-foreground">Loading...</p>
          ) : sessions.length === 0 ? (
            <p className="text-muted-foreground">No workout history for this exercise yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {lastSession && (
                  <div className="surface p-6">
                    <h2 className="text-sm font-medium text-muted-foreground mb-2">Last Session</h2>
                    <p className="text-xs text-muted-foreground/80 mb-3">
                      {format(new Date(lastSession.date), 'MMM d, yyyy')}
                    </p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Best Set:</span>
                        <span className="text-sm font-medium text-foreground">{lastSession.bestSet}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Volume:</span>
                        <span className="text-sm font-medium text-foreground">{lastSession.volume} kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Est 1RM:</span>
                        <span className="text-sm font-medium text-foreground">
                          {lastSession.est1RM > 0 ? `${lastSession.est1RM} kg` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {previousSession && (
                  <div className="surface p-6">
                    <h2 className="text-sm font-medium text-muted-foreground mb-2">Previous Session</h2>
                    <p className="text-xs text-muted-foreground/80 mb-3">
                      {format(new Date(previousSession.date), 'MMM d, yyyy')}
                    </p>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Best Set:</span>
                        <span className="text-sm font-medium text-foreground">{previousSession.bestSet}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Volume:</span>
                        <span className="text-sm font-medium text-foreground">{previousSession.volume} kg</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Est 1RM:</span>
                        <span className="text-sm font-medium text-foreground">
                          {previousSession.est1RM > 0 ? `${previousSession.est1RM} kg` : 'N/A'}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="surface overflow-hidden">
                <h2 className="text-lg font-semibold tracking-tight p-6 pb-4">Session History</h2>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-muted/40 border-b border-border/60">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs sm:text-sm font-medium text-muted-foreground">Date</th>
                        <th className="px-4 py-3 text-left text-xs sm:text-sm font-medium text-muted-foreground">Best Set</th>
                        <th className="px-4 py-3 text-left text-xs sm:text-sm font-medium text-muted-foreground">Volume</th>
                        <th className="px-4 py-3 text-left text-xs sm:text-sm font-medium text-muted-foreground">Est 1RM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {sessions.map((session, idx) => (
                        <tr key={idx} className="hover:bg-accent/30">
                          <td className="px-4 py-3 text-sm text-foreground">
                            {format(new Date(session.date), 'MMM d, yyyy')}
                          </td>
                          <td className="px-4 py-3 text-sm text-foreground">{session.bestSet}</td>
                          <td className="px-4 py-3 text-sm text-foreground">{session.volume} kg</td>
                          <td className="px-4 py-3 text-sm text-foreground">
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
