'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Exercise } from '@/lib/types';
import { computeExerciseMetrics, computeExerciseMetricsDetailed } from '@/lib/progressUtils';
import { ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Line,
  LineChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from 'recharts';

export const dynamic = 'force-dynamic';

interface SessionMetrics {
  sessionId: string;
  date: string;
  volume: number;
  bestSet: string;
  est1RM: number;
  bestWeight: number;
  bestReps: number;
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
      // Pull enough data for meaningful trends/PRs without overfetching.
      .limit(24);

    if (workoutExercises && workoutExercises.length > 0) {
      const metricsPromises = workoutExercises.map(async (we) => {
        const { data: setsData } = await supabase
          .from('workout_sets')
          .select('*')
          .eq('workout_exercise_id', we.id);

        const metrics = computeExerciseMetrics(setsData || []);
        const detailed = computeExerciseMetricsDetailed(setsData || []);
        return {
          sessionId: we.workout_session_id,
          date: (we as any).workout_sessions.started_at,
          ...metrics,
          bestWeight: detailed.bestWeight,
          bestReps: detailed.bestReps,
        };
      });

      const metricsData = await Promise.all(metricsPromises);
      setSessions(metricsData);
    }

    setLoading(false);
  };

  const lastSession = sessions[0];
  const previousSession = sessions[1];

  const bestEver = sessions.reduce(
    (acc, s) => {
      return {
        volume: Math.max(acc.volume, s.volume || 0),
        bestWeight: Math.max(acc.bestWeight, s.bestWeight || 0),
        est1RM: Math.max(acc.est1RM, s.est1RM || 0),
      };
    },
    { volume: 0, bestWeight: 0, est1RM: 0 }
  );

  const isPR = (metric: 'volume' | 'bestWeight' | 'est1RM') => {
    if (!lastSession) return false;
    const val = (lastSession as any)[metric] || 0;
    return val > 0 && val >= (bestEver as any)[metric];
  };

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
                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                          {lastSession.bestSet}
                          {isPR('bestWeight') && (
                            <Badge variant="secondary" className="h-5 px-2 text-[10px]">PR</Badge>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Volume:</span>
                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                          {lastSession.volume} kg
                          {isPR('volume') && (
                            <Badge variant="secondary" className="h-5 px-2 text-[10px]">PR</Badge>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-sm text-muted-foreground">Est 1RM:</span>
                        <span className="text-sm font-medium text-foreground flex items-center gap-2">
                          {lastSession.est1RM > 0 ? `${lastSession.est1RM} kg` : 'N/A'}
                          {isPR('est1RM') && (
                            <Badge variant="secondary" className="h-5 px-2 text-[10px]">PR</Badge>
                          )}
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

              <div className="surface p-6 mb-6">
                <h2 className="text-lg font-semibold tracking-tight mb-4">Trends</h2>
                {sessions.length < 2 ? (
                  <p className="text-sm text-muted-foreground">Complete more sessions to see trends.</p>
                ) : (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">Volume</p>
                      <ChartContainer
                        config={{
                          volume: { label: 'Volume', color: 'hsl(var(--primary))' },
                        }}
                        className="w-full"
                      >
                        <LineChart
                          data={[...sessions]
                            .slice(0, 12)
                            .reverse()
                            .map((s) => ({
                              date: format(new Date(s.date), 'MM/dd'),
                              volume: s.volume,
                            }))}
                          margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tickLine={false} axisLine={false} />
                          <YAxis tickLine={false} axisLine={false} width={36} />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="line" />}
                          />
                          <Line
                            type="monotone"
                            dataKey="volume"
                            stroke="var(--color-volume)"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ChartContainer>
                    </div>

                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">Estimated 1RM</p>
                      <ChartContainer
                        config={{
                          est1RM: { label: 'Est 1RM', color: 'hsl(var(--primary))' },
                        }}
                        className="w-full"
                      >
                        <LineChart
                          data={[...sessions]
                            .slice(0, 12)
                            .reverse()
                            .map((s) => ({
                              date: format(new Date(s.date), 'MM/dd'),
                              est1RM: s.est1RM,
                            }))}
                          margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" />
                          <XAxis dataKey="date" tickLine={false} axisLine={false} />
                          <YAxis tickLine={false} axisLine={false} width={36} />
                          <ChartTooltip
                            content={<ChartTooltipContent indicator="line" />}
                          />
                          <Line
                            type="monotone"
                            dataKey="est1RM"
                            stroke="var(--color-est1RM)"
                            strokeWidth={2}
                            dot={false}
                          />
                        </LineChart>
                      </ChartContainer>
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
