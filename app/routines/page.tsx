
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import nextDynamic from 'next/dynamic';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Routine } from '@/lib/types';
import { Plus, Edit2, Trash2, Share2 } from 'lucide-react';
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
        .select('id,name,notes,created_at,user_id')
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
      .select('id,name,notes,created_at,user_id')
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

      {isCoach ? (
        <ShareRoutineDialog open={shareOpen} onOpenChange={setShareOpen} routine={shareRoutine} />
      ) : null}
    </AuthGuard>
  );
}