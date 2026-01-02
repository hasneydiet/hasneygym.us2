'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Routine } from '@/lib/types';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export const dynamic = 'force-dynamic';

export default function RoutinesPage() {
  const router = useRouter();
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ name: '', notes: '' });

  useEffect(() => {
    loadRoutines();
  }, []);

  const loadRoutines = async () => {
    const { data, error } = await supabase
      .from('routines')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRoutines(data);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('routines')
      .insert({
        ...formData,
        user_id: user.id,
      })
      .select()
      .single();

    if (!error && data) {
      router.push(`/routines/${data.id}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this routine and all its data?')) {
      await supabase.from('routines').delete().eq('id', id);
      loadRoutines();
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
    </AuthGuard>
  );
}
