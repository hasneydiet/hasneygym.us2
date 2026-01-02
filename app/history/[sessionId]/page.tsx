'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { WorkoutSession, WorkoutExercise, WorkoutSet } from '@/lib/types';
import { format } from 'date-fns';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default function SessionDetailPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.sessionId as string;

  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [sets, setSets] = useState<{ [exerciseId: string]: WorkoutSet[] }>({});

  useEffect(() => {
    loadSession();
  }, [sessionId]);

  const loadSession = async () => {
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
    </div>
  );
}
