
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Routine } from '@/lib/types';
import { Plus, Edit2, Trash2, Share2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cacheDel, cacheGet, cacheSet } from '@/lib/perfCache';

const ShareRoutineDialog = nextDynamic(() => import('@/components/ShareRoutineDialog'), { ssr: false });

export const dynamic = 'force-dynamic';

function normalizeRoutines(rows: any[]): Routine[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const createdBy = (r as any).created_by ?? (r as any).user_id ?? null;
    return {
      id: String((r as any).id),
      name: String((r as any).name ?? ''),
      notes: String((r as any).notes ?? ''),
      created_at: String((r as any).created_at ?? ''),
      created_by: createdBy,
    } satisfies Routine;
  });
}

export default function RoutinesPage() {
  const router = useRouter();
  const { effectiveUserId, ready, isCoach, impersonateUserId } = useCoach();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', notes: '' });

  const [cloningRoutineId, setCloningRoutineId] = useState<string | null>(null);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareRoutine, setShareRoutine] = useState<Routine | null>(null);

  const routinesCacheKey = useMemo(() => {
    if (isCoach && !impersonateUserId) return 'routines:coach:all:v1';
    return effectiveUserId ? `routines:user:${effectiveUserId}:v1` : null;
  }, [effectiveUserId, isCoach, impersonateUserId]);

  useEffect(() => {
    if (!ready) return;
    if (effectiveUserId) loadRoutines(effectiveUserId);
  }, [ready, effectiveUserId, isCoach, impersonateUserId]);

  const loadRoutines = async (uid: string) => {
    if (!uid) return;

    // Fast path: use a short-lived session cache to avoid repeat fetches when navigating.
    if (routinesCacheKey) {
      const cached = cacheGet<Routine[]>(routinesCacheKey);
      if (cached && Array.isArray(cached)) {
        setRoutines(cached);
        return;
      }
    }

    // Coach (not impersonating): show all routines across all users, deduped by name.
    if (isCoach && !impersonateUserId) {
      const { data, error } = await supabase
        .from('routines')
        .select('id,name,notes,created_at,user_id,created_by')
        .order('created_at', { ascending: false });

      if (!error && data) {
        const normalized = normalizeRoutines(data as any[]);
        const seen = new Set<string>();
        const deduped: Routine[] = [];
        for (const r of normalized) {
          const key = String(r.name || '').trim().toLowerCase();
          if (!key) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(r);
        }
        setRoutines(deduped);
        if (routinesCacheKey) cacheSet(routinesCacheKey, deduped, 20 * 1000);
      }
      return;
    }

    // Everyone else (including coach while impersonating): user-scoped routines.
    const { data, error } = await supabase
      .from('routines')
      .select('id,name,notes,created_at,user_id,created_by')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (!error && data) {
      const normalized = normalizeRoutines(data as any[]);
      setRoutines(normalized);
      if (routinesCacheKey) cacheSet(routinesCacheKey, normalized, 20 * 1000);
    }
  };

  const openShare = async (routine: Routine) => {
    if (!isCoach) return;
    setShareRoutine(routine);
    setShareOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const uid = effectiveUserId;
    if (!uid) return;

    const { data, error } = await supabase
      .from('routines')
      .insert({ ...formData, user_id: uid })
      .select()
      .single();

    if (!error && data) {
      if (routinesCacheKey) cacheDel(routinesCacheKey);
      router.push(`/routines/${data.id}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this routine and all its data?')) {
      await supabase.from('routines').delete().eq('id', id);
      if (routinesCacheKey) cacheDel(routinesCacheKey);
      if (effectiveUserId) loadRoutines(effectiveUserId);
    }
  };

  const handleClone = async (routine: Routine) => {
    // For coach view of all routines (not impersonating), cloning would be ambiguous.
    if (isCoach && !impersonateUserId) return;

    const uid = effectiveUserId;
    if (!uid) return;

    if (cloningRoutineId) return;
    setCloningRoutineId(routine.id);

    try {
      // Pull full routine template (days + exercises) so we can deep-copy.
      const { data: routineRow, error: routineErr } = await supabase
        .from('routines')
        .select(
          `
          id,
          name,
          notes,
          routine_days(
            id,
            day_index,
            name,
            routine_day_exercises(
              id,
              exercise_id,
              order_index,
              superset_group_id,
              default_sets
            )
          )
        `
        )
        .eq('id', routine.id)
        .eq('user_id', uid)
        .single();

      if (routineErr || !routineRow) {
        alert('Could not clone routine. Please try again.');
        return;
      }

      const sourceName = String((routineRow as any).name ?? routine.name ?? '').trim();
      const cloneName = sourceName ? `${sourceName} (Copy)` : 'Routine (Copy)';

      // Create the new routine.
      const { data: newRoutine, error: newRoutineErr } = await supabase
        .from('routines')
        .insert({
          user_id: uid,
          name: cloneName,
          notes: (routineRow as any).notes ?? '',
        })
        .select('id')
        .single();

      if (newRoutineErr || !newRoutine?.id) {
        alert('Could not clone routine. Please try again.');
        return;
      }

      const sourceDays: any[] = Array.isArray((routineRow as any).routine_days)
        ? [...(routineRow as any).routine_days]
        : [];
      sourceDays.sort((a, b) => (a?.day_index ?? 0) - (b?.day_index ?? 0));

      // Insert routine days (preserve day_index order).
      const daysToInsert = sourceDays.map((d) => ({
        routine_id: newRoutine.id,
        day_index: d.day_index ?? 0,
        name: d.name ?? 'Day',
      }));

      const dayIdMap = new Map<string, string>();
      if (daysToInsert.length > 0) {
        const { data: newDays, error: daysErr } = await supabase
          .from('routine_days')
          .insert(daysToInsert)
          .select('id,day_index');

        if (daysErr || !newDays) {
          alert('Could not clone routine days. Please try again.');
          return;
        }

        // Map source day -> new day by day_index (stable within a routine)
        const byIndex = new Map<number, string>();
        for (const nd of newDays as any[]) byIndex.set(Number(nd.day_index ?? 0), String(nd.id));
        for (const sd of sourceDays) {
          const newDayId = byIndex.get(Number(sd.day_index ?? 0));
          if (newDayId) dayIdMap.set(String(sd.id), newDayId);
        }
      }

      // Insert routine day exercises.
      const exercisesToInsert: any[] = [];
      for (const sd of sourceDays) {
        const newDayId = dayIdMap.get(String(sd.id));
        if (!newDayId) continue;
        const sde: any[] = Array.isArray(sd.routine_day_exercises) ? sd.routine_day_exercises : [];
        sde.sort((a, b) => (a?.order_index ?? 0) - (b?.order_index ?? 0));
        for (const ex of sde) {
          exercisesToInsert.push({
            routine_day_id: newDayId,
            exercise_id: ex.exercise_id,
            order_index: ex.order_index ?? 0,
            superset_group_id: ex.superset_group_id ?? null,
            default_sets: ex.default_sets ?? [],
          });
        }
      }

      if (exercisesToInsert.length > 0) {
        const { error: exErr } = await supabase
          .from('routine_day_exercises')
          .insert(exercisesToInsert);

        if (exErr) {
          alert('Could not clone routine exercises. Please try again.');
          return;
        }
      }

      if (routinesCacheKey) cacheDel(routinesCacheKey);
      router.push(`/routines/${newRoutine.id}`);
    } finally {
      setCloningRoutineId(null);
    }
  };

      for (const d of originalDays) {
        const newDayId = dayIdMap.get(String(d.id));
        if (!newDayId) continue;
        const exs = Array.isArray((d as any).routine_day_exercises) ? (d as any).routine_day_exercises : [];
        for (const ex of exs) {
          exercisesToInsert.push({
            routine_day_id: newDayId,
            exercise_id: ex.exercise_id,
            order_index: ex.order_index ?? 0,
            superset_group_id: ex.superset_group_id ?? null,
            default_sets: ex.default_sets ?? [],
          });
        }
      }

      if (exercisesToInsert.length > 0) {
        const { error: exErr } = await supabase
          .from('routine_day_exercises')
          .insert(exercisesToInsert);
        if (exErr) {
          alert('Could not clone routine exercises. Please try again.');
          return;
        }
      }

      if (routinesCacheKey) cacheDel(routinesCacheKey);
      router.push(`/routines/${newRoutine.id}`);
    } finally {
      setCloningRoutineId(null);
    }
  };

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page">
          <div className="flex items-start justify-between gap-3 mb-6">
            <div>
              <h1 className="page-title">Routines</h1>
              <p className="page-subtitle mt-1">Create and edit your training plans.</p>
            </div>

            <Button onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="w-5 h-5" />
              <span>New Routine</span>
            </Button>
          </div>

          {showForm && (
            <div className="surface p-6 sm:p-7 mb-6">
              <h2 className="text-lg font-semibold tracking-tight mb-4">Create Routine</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Routine Name *
                  </label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Notes
                  </label>
                  <Textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="flex gap-3">
                  <Button type="submit" className="flex-1">Create & Edit</Button>
                  <Button type="button" variant="outline" onClick={() => setShowForm(false)} className="flex-1">
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {routines.map((routine) => (
              <div key={routine.id} className="tile p-6">
                <h3 className="text-base sm:text-lg font-semibold tracking-tight mb-1">{routine.name}</h3>
                {routine.notes && (
                  <p className="text-sm text-muted-foreground mb-4 max-h-[4.5rem] overflow-hidden">{routine.notes}</p>
                )}
                <div className="flex gap-2">
                  <Button
                    onClick={() => router.push(`/routines/${routine.id}`)}
                    className="flex-1 gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span>Edit</span>
                  </Button>
                  {isCoach && (
                    <Button
                      onClick={() => openShare(routine)}
                      variant="outline"
                      className="tap-target px-3"
                      aria-label="Share routine"
                      title="Share"
                    >
                      <Share2 className="w-4 h-4" />
                    </Button>
                  )}
                  {!(isCoach && !impersonateUserId) && (
                    <Button
                      onClick={() => handleClone(routine)}
                      variant="outline"
                      className="tap-target px-3"
                      aria-label="Clone routine"
                      title="Clone"
                      disabled={cloningRoutineId === routine.id}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    onClick={() => handleDelete(routine.id)}
                    variant="outline"
                    className="tap-target px-3 text-destructive hover:text-destructive"
                    aria-label="Delete routine"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {routines.length === 0 && !showForm && (
            <div className="surface p-10 text-center text-muted-foreground">
              No routines yet. Create your first routine!
            </div>
          )}
        </div>
      </div>

      {isCoach ? (
        <ShareRoutineDialog open={shareOpen} onOpenChange={setShareOpen} routine={shareRoutine} />
      ) : null}
    </AuthGuard>
  );
}