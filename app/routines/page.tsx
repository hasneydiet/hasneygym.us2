'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Routine } from '@/lib/types';
import { Plus, Edit2, Trash2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export const dynamic = 'force-dynamic';

export default function RoutinesPage() {
  const router = useRouter();
  const { effectiveUserId, ready, isCoach, impersonateUserId } = useCoach();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', notes: '' });

  const [shareOpen, setShareOpen] = useState(false);
  const [shareRoutine, setShareRoutine] = useState<Routine | null>(null);
  const [coachUsers, setCoachUsers] = useState<Array<{ id: string; email: string | null }>>([]);
  const [shareUserId, setShareUserId] = useState<string>('');
  const [shareLoading, setShareLoading] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (effectiveUserId) loadRoutines(effectiveUserId);
  }, [ready, effectiveUserId, isCoach, impersonateUserId]);

  const loadRoutines = async (uid: string) => {
    if (!uid) return;

    // The app's Routine type includes a required `created_by` field, while the DB rows use `user_id`.
    // Normalize fetched rows to satisfy the type without changing any DB schema or behavior.
    const normalizeRoutine = (r: any): Routine => ({
      ...r,
      created_by: r.created_by ?? r.user_id,
    });

    // Coach (not impersonating): show all routines across all users, deduped by name.
    if (isCoach && !impersonateUserId) {
      const { data, error } = await supabase
        .from('routines')
        .select('id,user_id,name,notes,created_at')
        .order('created_at', { ascending: false });

      if (!error && data) {
        const seen = new Set<string>();
        const deduped: Routine[] = [];
        for (const r of data as any[]) {
          const key = String(r.name || '').trim().toLowerCase();
          if (!key) continue;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(normalizeRoutine(r));
        }
        setRoutines(deduped);
      }
      return;
    }

    // Everyone else (including coach while impersonating): user-scoped routines.
    const { data, error } = await supabase
      .from('routines')
      .select('id,user_id,name,notes,created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRoutines((data as any[]).map(normalizeRoutine));
    }
  };

  const getAccessToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  };

  const loadCoachUsers = async () => {
    if (!isCoach) return;
    if (coachUsers.length > 0) return;

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch('/api/coach/users', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setCoachUsers((json?.users || []) as Array<{ id: string; email: string | null }>);
      }
    } catch {
      // Silent failure; coach page still works and Share can show alert.
    }
  };

  const openShare = async (routine: Routine) => {
    if (!isCoach) return;
    setShareRoutine(routine);
    setShareUserId('');
    setShareOpen(true);
    await loadCoachUsers();
  };

  const shareRoutineToUser = async () => {
    if (!isCoach) return;
    if (!shareRoutine) return;
    if (!shareUserId) return;

    setShareLoading(true);
    let newRoutineId: string | null = null;
    let succeeded = false;

    try {
      // Load the source routine (name/notes).
      const { data: sourceRoutine, error: sourceErr } = await supabase
        .from('routines')
        .select('id,name,notes')
        .eq('id', shareRoutine.id)
        .single();

      if (sourceErr || !sourceRoutine) {
        alert('Failed to load routine.');
        return;
      }

      const sourceNameKey = String(sourceRoutine.name || '').trim().toLowerCase();

      // Prevent duplicates by name for the target user.
      const { data: existing, error: existingErr } = await supabase
        .from('routines')
        .select('id,name')
        .eq('user_id', shareUserId);

      if (existingErr) {
        alert('Failed to validate target user routines.');
        return;
      }

      const hasDuplicate = (existing || []).some((r: any) => String(r.name || '').trim().toLowerCase() === sourceNameKey);
      if (hasDuplicate) {
        alert('That user already has a routine with this name.');
        return;
      }

      // Create the new routine for the target user.
      const { data: createdRoutine, error: createRoutineErr } = await supabase
        .from('routines')
        .insert({
          user_id: shareUserId,
          name: sourceRoutine.name,
          notes: sourceRoutine.notes ?? '',
        })
        .select('id')
        .single();

      if (createRoutineErr || !createdRoutine?.id) {
        alert('Failed to share routine.');
        return;
      }

      newRoutineId = createdRoutine.id;

      // Clone routine days.
      const { data: days, error: daysErr } = await supabase
        .from('routine_days')
        .select('*')
        .eq('routine_id', sourceRoutine.id)
        .order('day_index', { ascending: true });

      if (daysErr) {
        alert('Failed to share routine.');
        return;
      }

      const dayRows = (days || []) as any[];
      const { data: newDays, error: newDaysErr } = await supabase
        .from('routine_days')
        .insert(
          dayRows.map((d) => ({
            routine_id: newRoutineId,
            day_index: d.day_index,
            name: d.name,
          }))
        )
        .select('id,day_index');

      if (newDaysErr) {
        alert('Failed to share routine.');
        return;
      }

      const oldDayIds = dayRows.map((d) => d.id);
      const dayIdByIndex = new Map<number, string>();
      (newDays || []).forEach((d: any) => dayIdByIndex.set(d.day_index, d.id));

      // Clone day exercises.
      if (oldDayIds.length > 0) {
        const { data: dayExercises, error: dayExErr } = await supabase
          .from('routine_day_exercises')
          .select('*')
          .in('routine_day_id', oldDayIds)
          .order('order_index', { ascending: true });

        if (dayExErr) {
          alert('Failed to share routine.');
          return;
        }

        const insertExercises = (dayExercises || [])
          .map((ex: any) => {
            const oldDay = dayRows.find((d) => d.id === ex.routine_day_id);
            const newDayId = oldDay ? dayIdByIndex.get(oldDay.day_index) : null;
            if (!newDayId) return null;
            return {
              routine_day_id: newDayId,
              exercise_id: ex.exercise_id,
              order_index: ex.order_index,
              superset_group_id: ex.superset_group_id,
              default_sets: ex.default_sets ?? [],
            };
          })
          .filter(Boolean) as any[];

        if (insertExercises.length > 0) {
          const { error: insertErr } = await supabase.from('routine_day_exercises').insert(insertExercises);
          if (insertErr) {
            alert('Failed to share routine.');
            return;
          }
        }
      }

      setShareOpen(false);
      setShareRoutine(null);
      setShareUserId('');
      succeeded = true;
      alert('Routine shared.');
    } catch {
      alert('Failed to share routine.');
    } finally {
      // Best-effort rollback.
      if (!succeeded && newRoutineId) {
        await supabase.from('routines').delete().eq('id', newRoutineId);
      }
      setShareLoading(false);
    }
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
      router.push(`/routines/${data.id}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this routine and all its data?')) {
      await supabase.from('routines').delete().eq('id', id);
      if (effectiveUserId) loadRoutines(effectiveUserId);
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

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share Routine</DialogTitle>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              Select a user to receive: <span className="font-medium text-foreground">{shareRoutine?.name || ''}</span>
            </div>

            <Select value={shareUserId} onValueChange={setShareUserId}>
              <SelectTrigger>
                <SelectValue placeholder={coachUsers.length ? 'Select user' : 'Loading users...'} />
              </SelectTrigger>
              <SelectContent>
                {coachUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.email || u.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShareOpen(false)}
              disabled={shareLoading}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={shareRoutineToUser}
              disabled={!shareUserId || shareLoading}
            >
              Share
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthGuard>
  );
}