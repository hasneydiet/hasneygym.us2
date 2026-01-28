'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabaseClient } from '@/lib/supabase';
import { Routine } from '@/lib/types';
import { Button } from '@/components/ui/button';
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
import { cacheGet, cacheSet } from '@/lib/perfCache';

type CoachUserRow = { id: string; email: string | null };

export default function ShareRoutineDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  routine: Routine | null;
}) {
  const { open, onOpenChange, routine } = props;
  const [coachUsers, setCoachUsers] = useState<CoachUserRow[]>([]);
  const [shareUserId, setShareUserId] = useState<string>('');
  const [shareLoading, setShareLoading] = useState(false);

  // Reset selection when routine changes or dialog opens.
  useEffect(() => {
    if (!open) return;
    setShareUserId('');
  }, [open, routine?.id]);

  const getAccessToken = async () => {
    const supabase = await getSupabaseClient();
const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  };

  const usersCacheKey = useMemo(() => 'coach:users:v1', []);

  const loadCoachUsers = async () => {
    // Pull from short-lived session cache first (reduces repeat mobile work on route changes).
    const cached = cacheGet<CoachUserRow[]>(usersCacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      setCoachUsers(cached);
      return;
    }

    const token = await getAccessToken();
    if (!token) return;

    try {
      const res = await fetch('/api/coach/users', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        const users = (json?.users || []) as CoachUserRow[];
        setCoachUsers(users);
        cacheSet(usersCacheKey, users, 5 * 60 * 1000); // 5 min
      }
    } catch {
      // Silent failure; Share can still show the dialog with a loading placeholder.
    }
  };

  // Load users only when the dialog is opened.
  useEffect(() => {
    if (!open) return;
    loadCoachUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shareRoutineToUser = async () => {
    if (!routine) return;
    if (!shareUserId) return;

    setShareLoading(true);
    let newRoutineId: string | null = null;
    let succeeded = false;

    try {
      // Load the source routine (name/notes).
      const { data: sourceRoutine, error: sourceErr } = await supabase
        .from('routines')
        .select('id,name,notes')
        .eq('id', routine.id)
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

      const hasDuplicate = (existing || []).some(
        (r: any) => String(r.name || '').trim().toLowerCase() === sourceNameKey
      );
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
        .select('id,day_index,name')
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
          .select('routine_day_id,exercise_id,order_index,superset_group_id,default_sets')
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
          const { error: insertErr } = await supabase
            .from('routine_day_exercises')
            .insert(insertExercises);
          if (insertErr) {
            alert('Failed to share routine.');
            return;
          }
        }
      }

      onOpenChange(false);
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Routine</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm text-muted-foreground">
            Select a user to receive:{' '}
            <span className="font-medium text-foreground">{routine?.name || ''}</span>
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={shareLoading}>
            Cancel
          </Button>
          <Button type="button" onClick={shareRoutineToUser} disabled={!shareUserId || shareLoading}>
            Share
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
