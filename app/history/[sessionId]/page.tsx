'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { WorkoutSession, WorkoutExercise, WorkoutSet } from '@/lib/types';
import { computeExerciseMetricsDetailed } from '@/lib/progressUtils';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';


const formatDuration = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
};

export const dynamic = 'force-dynamic';

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { effectiveUserId } = useCoach();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});
  const [summary, setSummary] = useState<{
    totalVolume: number;
    completedSets: number;
    durationMinutes: number | null;
    prs: { exerciseName: string; metric: string; value: string }[];
  } | null>(null);

  useEffect(() => {
    loadSession();
  }, [sessionId, effectiveUserId]);

  const loadSession = async () => {
    if (!effectiveUserId) return;
    const { data: sessionData } = await supabase
      .from('workout_sessions')
      .select('*, routines(name), routine_days(name)')
      .eq('id', sessionId)
      .single();

    if (sessionData) {
      setSession(sessionData);

      const { data: exData } = await supabase
        .from('workout_exercises')
        .select('*, exercises(*)')
        .eq('workout_session_id', sessionId)
        .order('order_index');

      if (exData) {
        setExercises(exData);

        const setsMap: { [exerciseId: string]: WorkoutSet[] } = {};
        for (const ex of exData) {
          const { data: setsData } = await supabase
            .from('workout_sets')
            .select('*')
            .eq('workout_exercise_id', ex.id)
            .order('set_index');

          setsMap[ex.id] = setsData || [];
        }
        setSets(setsMap);

        // Compute session analytics (volume, PRs, duration) for this detail view.
        try {
          const total = exData.reduce(
            (acc, ex) => {
              const s = setsMap[ex.id] || [];
              const completedCount = s.filter((x) => x.is_completed).length;
              const m = computeExerciseMetricsDetailed(s);
              return {
                totalVolume: acc.totalVolume + (m.volume || 0),
                completedSets: acc.completedSets + completedCount,
                perExercise: {
                  ...acc.perExercise,
                  [ex.exercise_id]: {
                    name: ex.exercises?.name || 'Exercise',
                    volume: m.volume || 0,
                    bestWeight: m.bestWeight || 0,
                    bestReps: m.bestReps || 0,
                    est1RM: m.est1RM || 0,
                  },
                },
              };
            },
            {
              totalVolume: 0,
              completedSets: 0,
              perExercise: {} as Record<
                string,
                { name: string; volume: number; bestWeight: number; bestReps: number; est1RM: number }
              >,
            }
          );

          const durationMinutes =
            sessionData?.ended_at
              ? Math.max(
                  0,
                  Math.round(
                    (new Date(sessionData.ended_at).getTime() -
                      new Date(sessionData.started_at).getTime()) /
                      60000
                  )
                )
              : null;

          // Fetch prior bests for PR detection (compare this session vs user's previous sessions).
          const exerciseIds = Object.keys(total.perExercise);
          let prs: { exerciseName: string; metric: string; value: string }[] = [];

          if (exerciseIds.length > 0) {
            const { data: priorWorkoutExercises } = await supabase
              .from('workout_exercises')
              .select('id, exercise_id')
              .in('exercise_id', exerciseIds)
              .neq('workout_session_id', sessionId)
              .limit(400);

            if (priorWorkoutExercises && priorWorkoutExercises.length > 0) {
              const weIdToExerciseId: Record<string, string> = {};
              for (const we of priorWorkoutExercises as any[]) {
                weIdToExerciseId[we.id] = we.exercise_id;
              }

              const priorIds = (priorWorkoutExercises as any[]).map((x) => x.id);
              const { data: priorSets } = await supabase
                .from('workout_sets')
                .select('workout_exercise_id, reps, weight, is_completed')
                .in('workout_exercise_id', priorIds);

              // Compute best-per-workout_exercise, then take max per exercise_id.
              const setsByWE: Record<string, WorkoutSet[]> = {};
              for (const s of (priorSets || []) as any[]) {
                const id = s.workout_exercise_id as string;
                if (!setsByWE[id]) setsByWE[id] = [];
                setsByWE[id].push(s as WorkoutSet);
              }

              const bestByExercise: Record<
                string,
                { volume: number; bestWeight: number; est1RM: number }
              > = {};

              for (const [weId, sArr] of Object.entries(setsByWE)) {
                const exId = weIdToExerciseId[weId];
                if (!exId) continue;
                const m = computeExerciseMetricsDetailed(sArr);
                const cur = bestByExercise[exId] || { volume: 0, bestWeight: 0, est1RM: 0 };
                bestByExercise[exId] = {
                  volume: Math.max(cur.volume, m.volume || 0),
                  bestWeight: Math.max(cur.bestWeight, m.bestWeight || 0),
                  est1RM: Math.max(cur.est1RM, m.est1RM || 0),
                };
              }

              // Compare this session's metrics vs prior best.
              for (const exId of exerciseIds) {
                const cur = total.perExercise[exId];
                const prev = bestByExercise[exId] || { volume: 0, bestWeight: 0, est1RM: 0 };
                if (cur.bestWeight > 0 && cur.bestWeight > prev.bestWeight) {
                  prs.push({
                    exerciseName: cur.name,
                    metric: 'Best Weight',
                    value: `${cur.bestWeight} × ${cur.bestReps}`,
                  });
                }
                if (cur.est1RM > 0 && cur.est1RM > prev.est1RM) {
                  prs.push({
                    exerciseName: cur.name,
                    metric: 'Est 1RM',
                    value: `${cur.est1RM}`,
                  });
                }
                if (cur.volume > 0 && cur.volume > prev.volume) {
                  prs.push({
                    exerciseName: cur.name,
                    metric: 'Volume',
                    value: `${cur.volume}`,
                  });
                }
              }
            }
          }

          setSummary({
            totalVolume: Math.round(total.totalVolume),
            completedSets: total.completedSets,
            durationMinutes,
            prs: prs.slice(0, 12),
          });
        } catch (e) {
          // Fail-safe: session detail should remain usable even if analytics fail.
          setSummary(null);
        }
      }
    }
  };

  const deleteSession = async () => {
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

    router.push('/history');
  };

  const groupBySupersets = (exs: WorkoutExercise[]) => {
    const groups: { superset_group_id: string | null; items: WorkoutExercise[] }[] = [];
    const seen = new Set<string | null>();

    exs.forEach((ex) => {
      if (ex.superset_group_id && !seen.has(ex.superset_group_id)) {
        seen.add(ex.superset_group_id);
        groups.push({
          superset_group_id: ex.superset_group_id,
          items: exs.filter((e) => e.superset_group_id === ex.superset_group_id),
        });
      } else if (!ex.superset_group_id) {
        groups.push({ superset_group_id: null, items: [ex] });
      }
    });

    return groups;
  };

  const grouped = groupBySupersets(exercises);

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page max-w-4xl">
          <Button onClick={() => router.push('/history')} variant="outline" className="w-fit mb-4">
            ← Back to History
          </Button>

          {session && (
            <div className="surface p-6 mb-6">
              <div className="flex justify-between items-start">
                <div className="flex-1">
                  <h1 className="text-2xl font-semibold tracking-tight mb-2">
                    {session.routines?.name || 'Quick Workout'}
                  </h1>
                  {session.routine_days?.name && (
                    <p className="text-muted-foreground mb-1">{session.routine_days.name}</p>
                  )}
                  <p className="text-sm text-muted-foreground/80">
                    {format(new Date(session.started_at), 'MMM d, yyyy • h:mm a')}
                    {session.ended_at && (
                      <> - {format(new Date(session.ended_at), 'h:mm a')}</>
                    )}
                  </p>
                </div>
                <button
                  onClick={deleteSession}
                  className="icon-btn ml-2 text-destructive hover:text-destructive"
                  title="Delete session"
                  aria-label="Delete session"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
              {!session.ended_at && (
                <Button onClick={() => router.push(`/workout/${sessionId}`)} className="mt-4">
                  Resume Workout
                </Button>
              )}

              {summary && (
                <div className="mt-4 pt-4 border-t border-border/60">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Volume</p>
                      <p className="text-sm font-semibold text-foreground">{summary.totalVolume}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Completed Sets</p>
                      <p className="text-sm font-semibold text-foreground">{summary.completedSets}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Duration</p>
                      <p className="text-sm font-semibold text-foreground">
                        {summary.durationMinutes != null ? `${summary.durationMinutes} min` : '—'}
                      </p>
                    </div>
                  </div>

                  {summary.prs.length > 0 && (
                    <div className="mt-4">
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground mb-2">PRs this session</p>
                      <div className="flex flex-wrap gap-2">
                        {summary.prs.map((p, idx) => (
                          <Badge key={`${p.exerciseName}-${p.metric}-${idx}`} variant="secondary" className="border-border/60">
                            {p.exerciseName}: {p.metric} {p.value}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="space-y-4">
            {grouped.map((group, gIdx) => {
              if (group.superset_group_id) {
                return (
                  <div key={gIdx} className="surface overflow-hidden border-l-4 border-primary/60">
                    <div className="bg-muted/40 px-4 py-2 border-b border-border/60">
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground">SUPERSET</p>
                    </div>
                    {group.items.map((ex) => (
                      <ExerciseDetail key={ex.id} exercise={ex} sets={sets[ex.id] || []} />
                    ))}
                  </div>
                );
              } else {
                const ex = group.items[0];
                return (
                  <div key={ex.id} className="surface overflow-hidden">
                    <ExerciseDetail exercise={ex} sets={sets[ex.id] || []} />
                  </div>
                );
              }
            })}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

function ExerciseDetail({
  exercise,
  sets,
}: {
  exercise: WorkoutExercise;
  sets: WorkoutSet[];
}) {
  const exType = (exercise as any)?.exercises?.exercise_type || ((exercise as any)?.exercises?.muscle_group === 'Cardio' ? 'cardio' : 'strength');
  const isCardio = exType === 'cardio';

  return (
    <div className="p-4">
      <h3 className="text-base sm:text-lg font-semibold tracking-tight mb-2">{exercise.exercises?.name}</h3>

      {exercise.technique_tags && exercise.technique_tags.length > 0 && (
        <div className="mb-3">
          <div className="flex flex-wrap gap-2">
            {exercise.technique_tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="border-border/60">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {isCardio ? (
        <div className="mt-2 text-sm">
          <div className="text-muted-foreground">Duration</div>
          <div className="font-semibold">{formatDuration(Number((exercise as any).duration_seconds || 0))}</div>
        </div>
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-muted-foreground bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left">Set</th>
              <th className="px-3 py-2 text-center">Reps</th>
              <th className="px-3 py-2 text-center">Weight</th>
              <th className="px-3 py-2 text-center">RPE</th>
              <th className="px-3 py-2 text-center">Done</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sets.map((set, idx) => (
              <tr key={set.id} className="hover:bg-accent/30">
                <td className="px-3 py-2 font-medium text-foreground">{idx + 1}</td>
                <td className="px-3 py-2 text-center text-foreground">{set.reps}</td>
                <td className="px-3 py-2 text-center text-foreground">{set.weight}</td>
                <td className="px-3 py-2 text-center text-foreground">{set.rpe || '-'}</td>
                <td className="px-3 py-2 text-center text-foreground">
                  {set.is_completed ? '✓' : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

