'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Routine, RoutineDay, RoutineDayExercise, Exercise } from '@/lib/types';
import { Plus, Trash2, ChevronUp, ChevronDown, X, PencilLine, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default function RoutineEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { effectiveUserId } = useCoach();
  const routineId = params.id as string;

  const [routine, setRoutine] = useState<Routine | null>(null);
  const [days, setDays] = useState<RoutineDay[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [dayExercises, setDayExercises] = useState<{ [dayId: string]: RoutineDayExercise[] }>({});
  const [showAddDay, setShowAddDay] = useState(false);
  const [showAddExercise, setShowAddExercise] = useState<string | null>(null);
  const [newDayName, setNewDayName] = useState('');
  const [selectedExerciseId, setSelectedExerciseId] = useState('');

  // Inline rename (minimal behavior change: updates existing fields only)
  const [isEditingRoutineName, setIsEditingRoutineName] = useState(false);
  const [routineNameDraft, setRoutineNameDraft] = useState('');
  const [editingDayId, setEditingDayId] = useState<string | null>(null);
  const [dayNameDraft, setDayNameDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    loadRoutine();
    loadExercises();
  }, [routineId]);

  const loadRoutine = async () => {
    if (!effectiveUserId) return;
    const { data: routineData } = await supabase
      .from('routines')
      .select('*')
      .eq('id', routineId)
      .eq('user_id', effectiveUserId)
      .single();

    if (routineData) {
      setRoutine(routineData);
      setRoutineNameDraft(routineData.name || '');

      const { data: daysData } = await supabase
        .from('routine_days')
        .select('*')
        .eq('routine_id', routineId)
        .order('day_index');

      if (daysData) {
        setDays(daysData);

        // initialize day name drafts (keeps inputs stable)
        const drafts: Record<string, string> = {};
        for (const d of daysData) drafts[d.id] = d.name || '';
        setDayNameDraft(drafts);

        // Keep drafts in sync (without stomping active edits)
        setDayNameDraft((prev) => {
          const next = { ...prev };
          for (const d of daysData) {
            if (typeof next[d.id] !== 'string') next[d.id] = d.name || '';
          }
          return next;
        });

        const exMap: { [dayId: string]: RoutineDayExercise[] } = {};
        for (const day of daysData) {
          const { data: exData } = await supabase
            .from('routine_day_exercises')
            .select('*, exercises(*)')
            .eq('routine_day_id', day.id)
            .order('order_index');

          exMap[day.id] = exData || [];
        }
        setDayExercises(exMap);
      }
    }
  };

  const loadExercises = async () => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .eq('user_id', effectiveUserId)
      .order('name');

    if (data) setExercises(data);
  };

  const startEditRoutineName = () => {
    if (!routine) return;
    setRoutineNameDraft(routine.name || '');
    setIsEditingRoutineName(true);
  };

  const saveRoutineName = async () => {
    if (!routine) return;
    const nextName = routineNameDraft.trim();
    if (!nextName || nextName === (routine.name || '')) {
      setIsEditingRoutineName(false);
      setRoutineNameDraft(routine.name || '');
      return;
    }

    // optimistic UI
    const prev = routine;
    setRoutine({ ...routine, name: nextName });
    setIsEditingRoutineName(false);

    const { error } = await supabase
      .from('routines')
      .update({ name: nextName })
      .eq('id', routineId);

    if (error) {
      // revert on failure
      setRoutine(prev);
      setRoutineNameDraft(prev.name || '');
      alert('Could not rename routine. Please try again.');
    }
  };

  const startEditDayName = (day: RoutineDay) => {
    setEditingDayId(day.id);
    setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
  };

  const saveDayName = async (day: RoutineDay) => {
    const nextName = (dayNameDraft[day.id] || '').trim();
    if (!nextName || nextName === (day.name || '')) {
      setEditingDayId(null);
      setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
      return;
    }

    // optimistic UI
    const prevDays = days;
    setDays((cur) => cur.map((d) => (d.id === day.id ? { ...d, name: nextName } : d)));
    setEditingDayId(null);

    const { error } = await supabase
      .from('routine_days')
      .update({ name: nextName })
      .eq('id', day.id);

    if (error) {
      setDays(prevDays);
      setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
      alert('Could not rename day. Please try again.');
    }
  };

  const addDay = async () => {
    if (!newDayName.trim()) return;

    const nextIndex = days.length;
    const { data } = await supabase
      .from('routine_days')
      .insert({
        routine_id: routineId,
        day_index: nextIndex,
        name: newDayName,
      })
      .select()
      .single();

    if (data) {
      setDays([...days, data]);
      setDayExercises({ ...dayExercises, [data.id]: [] });
      setDayNameDraft((prev) => ({ ...prev, [data.id]: data.name || '' }));
      setNewDayName('');
      setShowAddDay(false);
    }
  };

  const deleteDay = async (dayId: string) => {
    if (confirm('Delete this day?')) {
      await supabase.from('routine_days').delete().eq('id', dayId);
      loadRoutine();
    }
  };

  const addExerciseToDayHandler = async (dayId: string) => {
    if (!selectedExerciseId) return;

    const currentExercises = dayExercises[dayId] || [];
    const nextIndex = currentExercises.length;

    const { data } = await supabase
      .from('routine_day_exercises')
      .insert({
        routine_day_id: dayId,
        exercise_id: selectedExerciseId,
        order_index: nextIndex,
      })
      .select()
      .single();

    if (data) {
      loadRoutine();
      setShowAddExercise(null);
      setSelectedExerciseId('');
    }
  };

  const deleteExerciseFromDay = async (exerciseId: string) => {
    await supabase.from('routine_day_exercises').delete().eq('id', exerciseId);
    loadRoutine();
  };

  const moveExercise = async (dayId: string, exerciseId: string, direction: 'up' | 'down') => {
    const exs = [...(dayExercises[dayId] || [])];
    const idx = exs.findIndex((e) => e.id === exerciseId);
    if (idx === -1) return;

    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx === exs.length - 1) return;

    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    [exs[idx], exs[newIdx]] = [exs[newIdx], exs[idx]];

    for (let i = 0; i < exs.length; i++) {
      await supabase
        .from('routine_day_exercises')
        .update({ order_index: i })
        .eq('id', exs[i].id);
    }

    loadRoutine();
  };

  const toggleSuperset = async (dayId: string, exerciseId: string) => {
    const exs = dayExercises[dayId] || [];
    const ex = exs.find((e) => e.id === exerciseId);
    if (!ex) return;

    const newGroupId = ex.superset_group_id ? null : crypto.randomUUID();

    await supabase
      .from('routine_day_exercises')
      .update({ superset_group_id: newGroupId })
      .eq('id', exerciseId);

    loadRoutine();
  };

  const groupBySupersets = (exs: RoutineDayExercise[]) => {
    const groups: { superset_group_id: string | null; items: RoutineDayExercise[] }[] = [];
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

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page max-w-7xl">
          <div className="routine-sticky">
            <button
              onClick={() => router.push('/routines')}
              className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
            >
              ← Back to Routines
            </button>
            <div className="flex items-start justify-between gap-3">
              {isEditingRoutineName ? (
                <div className="flex-1">
                  <Input
                    value={routineNameDraft}
                    onChange={(e) => setRoutineNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRoutineName();
                      if (e.key === 'Escape') {
                        setIsEditingRoutineName(false);
                        setRoutineNameDraft(routine?.name || '');
                      }
                    }}
                    onBlur={saveRoutineName}
                    className="h-12 text-base font-semibold"
                    aria-label="Routine name"
                    autoFocus
                  />
                </div>
              ) : (
                <h1 className="page-title flex-1 pr-2">{routine?.name}</h1>
              )}

              {isEditingRoutineName ? (
                <div className="flex items-center gap-1 pt-1">
                  <button
                    onClick={saveRoutineName}
                    className="icon-btn"
                    aria-label="Save routine name"
                    title="Save"
                  >
                    <Check className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      setIsEditingRoutineName(false);
                      setRoutineNameDraft(routine?.name || '');
                    }}
                    className="icon-btn"
                    aria-label="Cancel"
                    title="Cancel"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={startEditRoutineName}
                  className="icon-btn"
                  aria-label="Rename routine"
                  title="Rename"
                >
                  <PencilLine className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {days.map((day) => {
              const exs = dayExercises[day.id] || [];
              const grouped = groupBySupersets(exs);

              return (
                <div key={day.id} className="surface p-6">
                  <div className="day-sticky-header flex justify-between items-center gap-3">
                    {editingDayId === day.id ? (
                      <div className="flex-1 pr-2">
                        <Input
                          value={dayNameDraft[day.id] ?? ''}
                          onChange={(e) => setDayNameDraft((prev) => ({ ...prev, [day.id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveDayName(day);
                            if (e.key === 'Escape') {
                              setEditingDayId(null);
                              setDayNameDraft((prev) => ({ ...prev, [day.id]: day.name || '' }));
                            }
                          }}
                          onBlur={() => saveDayName(day)}
                          className="h-11 text-sm font-semibold"
                          aria-label="Day name"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1 pr-2">
                        <h2 className="text-lg font-semibold tracking-tight truncate">{day.name}</h2>
                        <button
                          onClick={() => startEditDayName(day)}
                          className="icon-btn"
                          aria-label="Rename day"
                          title="Rename day"
                        >
                          <PencilLine className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                    <button
                      onClick={() => deleteDay(day.id)}
                      className="icon-btn text-destructive hover:text-destructive"
                      aria-label="Delete day"
                      title="Delete day"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-2 mb-4">
                    {grouped.map((group, gIdx) => {
                      if (group.superset_group_id) {
                        return (
                          <div key={gIdx} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
                            <div className="mb-2">
                              <Badge variant="secondary" className="border-border/60">SUPERSET</Badge>
                            </div>
                            {group.items.map((ex) => (
                              <div key={ex.id} className="flex items-center justify-between py-2">
                                <span className="font-medium text-foreground">{ex.exercises?.name}</span>
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => moveExercise(day.id, ex.id, 'up')}
                                    className="icon-btn"
                                    aria-label="Move up"
                                  >
                                    <ChevronUp className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => moveExercise(day.id, ex.id, 'down')}
                                    className="icon-btn"
                                    aria-label="Move down"
                                  >
                                    <ChevronDown className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => toggleSuperset(day.id, ex.id)}
                                    className="tap-target rounded-xl border border-border/60 bg-background bg-opacity-60 px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                                  >
                                    Ungroup
                                  </button>
                                  <button
                                    onClick={() => deleteExerciseFromDay(ex.id)}
                                    className="icon-btn text-destructive hover:text-destructive"
                                    aria-label="Delete exercise"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      } else {
                        const ex = group.items[0];
                        return (
                          <div key={ex.id} className="flex items-center justify-between py-2 border-b border-border/50">
                            <span className="font-medium text-foreground">{ex.exercises?.name}</span>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => moveExercise(day.id, ex.id, 'up')}
                                className="icon-btn"
                                aria-label="Move up"
                              >
                                <ChevronUp className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => moveExercise(day.id, ex.id, 'down')}
                                className="icon-btn"
                                aria-label="Move down"
                              >
                                <ChevronDown className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => toggleSuperset(day.id, ex.id)}
                                className="tap-target rounded-xl border border-border/60 bg-background bg-opacity-60 px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                              >
                                Superset
                              </button>
                              <button
                                onClick={() => deleteExerciseFromDay(ex.id)}
                                className="icon-btn text-destructive hover:text-destructive"
                                aria-label="Delete exercise"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>

                  {showAddExercise === day.id ? (
                    <div className="border-t border-border/60 pt-4">
                      <select
                        value={selectedExerciseId}
                        onChange={(e) => setSelectedExerciseId(e.target.value)}
                        className="w-full h-11 rounded-xl border border-input bg-background bg-opacity-70 backdrop-blur px-3 text-sm text-foreground mb-2"
                      >
                        <option value="">Select Exercise</option>
                        {exercises.map((ex) => (
                          <option key={ex.id} value={ex.id}>
                            {ex.name}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <Button onClick={() => addExerciseToDayHandler(day.id)} className="flex-1">Add</Button>
                        <Button onClick={() => setShowAddExercise(null)} variant="outline" className="flex-1">Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button onClick={() => setShowAddExercise(day.id)} variant="outline" className="w-full gap-2">
                      <Plus className="w-4 h-4" />
                      <span>Add Exercise</span>
                    </Button>
                  )}
                </div>
              );
            })}

            {showAddDay ? (
              <div className="surface p-6">
                <h2 className="text-lg font-semibold tracking-tight mb-4">Add Day</h2>
                <Input
                  type="text"
                  value={newDayName}
                  onChange={(e) => setNewDayName(e.target.value)}
                  placeholder="Day name (e.g., Push Day, Leg Day)"
                  className="mb-4"
                />
                <div className="flex gap-2">
                  <Button onClick={addDay} className="flex-1">Add</Button>
                  <Button onClick={() => setShowAddDay(false)} variant="outline" className="flex-1">Cancel</Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setShowAddDay(true)}
                variant="outline"
                className="w-full h-14 border-dashed gap-2 text-muted-foreground hover:text-foreground"
              >
                <Plus className="w-5 h-5" />
                <span>Add Day</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}

