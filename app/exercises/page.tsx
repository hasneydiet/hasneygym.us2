'use client';

import { useEffect, useMemo, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Search, Pencil, Trash2 } from 'lucide-react';

export const dynamic = 'force-dynamic';

type Exercise = {
  id: string;
  name: string;
  muscle_group: string | null;
  equipment: string | null;
  notes: string | null;
  created_at: string;
  technique: string | null;
  rest_seconds: number;
  default_technique_tags?: string[] | null;
  default_set_scheme?: { sets?: number; reps?: number; restSeconds?: number; notes?: string } | null;
};

const MUSCLE_GROUPS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Abs',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Full Body',
];

const EQUIPMENT_OPTIONS = [
  'Barbell',
  'Dumbbell',
  'Machine',
  'Cable',
  'Bodyweight',
  'Kettlebell',
  'Band',
  'Other',
];

const TECHNIQUE_TAGS = [
  'Drop Set',
  'Rest Pause',
  'Tempo',
  'Paused Reps',
  'Cluster Set',
  'AMRAP',
  'Superset',
  'Giant Set',
  'Warm-up',
  'Working Set',
];

export default function ExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('All');

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);

  const emptyForm = useMemo(
    () => ({
      name: '',
      muscle_group: '',
      equipment: '',
      notes: '',
      rest_seconds: 60,
      default_technique_tags: [] as string[],
      default_set_scheme: null as { sets?: number; reps?: number; restSeconds?: number; notes?: string } | null,
      technique: '',
    }),
    []
  );

  const [formData, setFormData] = useState(emptyForm);

  useEffect(() => {
    loadExercises();
  }, []);

  const loadExercises = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('exercises')
      .select('id,name,muscle_group,equipment,notes,created_at,technique,rest_seconds,default_technique_tags,default_set_scheme')
      .order('name');

    if (error) {
      console.error('Error loading exercises:', error);
    } else if (data) {
      setExercises(data as Exercise[]);
    }

    setLoading(false);
  };

  const resetForm = () => {
    setFormData(emptyForm);
  };

  const normalizeMuscleGroup = (v: string) => v.trim();
  const normalizeEquipment = (v: string) => v.trim();
  const normalizeText = (v: string) => v;

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('Exercise name is required.');
      return;
    }

    const payload = {
      name: normalizeText(formData.name.trim()),
      muscle_group: formData.muscle_group ? normalizeMuscleGroup(formData.muscle_group) : null,
      equipment: formData.equipment ? normalizeEquipment(formData.equipment) : null,
      notes: formData.notes ? normalizeText(formData.notes) : null,
      technique: formData.technique ? normalizeText(formData.technique) : null,
      rest_seconds: formData.rest_seconds ?? 60,
      default_technique_tags: formData.default_technique_tags ?? [],
      default_set_scheme: formData.default_set_scheme,
    };

    if (editingExercise) {
      const { error } = await supabase.from('exercises').update(payload).eq('id', editingExercise.id);
      if (error) {
        console.error('Error updating exercise:', error);
        alert('Failed to update exercise.');
        return;
      }
    } else {
      const { error } = await supabase.from('exercises').insert(payload);
      if (error) {
        console.error('Error creating exercise:', error);
        alert('Failed to create exercise.');
        return;
      }
    }

    setIsDialogOpen(false);
    setEditingExercise(null);
    resetForm();
    loadExercises();
  };

  const handleEdit = (exercise: Exercise) => {
    setEditingExercise(exercise);
    setFormData({
      name: exercise.name || '',
      muscle_group: exercise.muscle_group || '',
      equipment: exercise.equipment || '',
      notes: exercise.notes || '',
      rest_seconds: exercise.rest_seconds ?? 60,
      default_technique_tags: (exercise.default_technique_tags as string[]) || [],
      default_set_scheme: exercise.default_set_scheme || null,
      technique: exercise.technique || '',
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this exercise?')) {
      const { error } = await supabase.from('exercises').delete().eq('id', id);
      if (error) {
        console.error('Error deleting exercise:', error);
        alert('Failed to delete exercise.');
        return;
      }
      loadExercises();
    }
  };

  const filteredExercises = useMemo(() => {
    const term = search.trim().toLowerCase();

    return exercises.filter((e) => {
      const matchesSearch =
        !term ||
        e.name.toLowerCase().includes(term) ||
        (e.muscle_group || '').toLowerCase().includes(term) ||
        (e.equipment || '').toLowerCase().includes(term) ||
        (e.technique || '').toLowerCase().includes(term);

      const matchesGroup = selectedMuscleGroup === 'All' || (e.muscle_group || '') === selectedMuscleGroup;

      return matchesSearch && matchesGroup;
    });
  }, [exercises, search, selectedMuscleGroup]);

  return (
    <AuthGuard>
      <div className="app-shell">
        <div className="page">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h1 className="page-title">Exercises</h1>
              <p className="page-subtitle">Manage your exercise library.</p>
            </div>

            <Button
              onClick={() => {
                setEditingExercise(null);
                resetForm();
                setIsDialogOpen(true);
              }}
              className="gap-2"
            >
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </div>

          <div className="surface p-4 sm:p-5 mb-5">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search exercises..."
                  className="pl-9"
                />
              </div>

              <select
                value={selectedMuscleGroup}
                onChange={(e) => setSelectedMuscleGroup(e.target.value)}
                className="h-10 rounded-xl border border-border bg-input px-3 text-sm text-foreground"
              >
                <option value="All">All muscle groups</option>
                {MUSCLE_GROUPS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-muted-foreground">Loading exercises...</div>
          ) : filteredExercises.length === 0 ? (
            <div className="text-sm text-muted-foreground">No exercises found.</div>
          ) : (
            <div className="space-y-3">
              {filteredExercises.map((exercise) => (
                <div key={exercise.id} className="surface p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold text-foreground truncate">{exercise.name}</div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {(exercise.muscle_group || 'Unassigned') + ' • ' + (exercise.equipment || 'Any')}
                      </div>
                      {exercise.technique ? (
                        <div className="text-xs text-muted-foreground mt-1">Technique: {exercise.technique}</div>
                      ) : null}
                      <div className="text-xs text-muted-foreground mt-1">Rest: {exercise.rest_seconds ?? 60}s</div>
                    </div>

                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => handleEdit(exercise)} className="h-9 w-9">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(exercise.id)}
                        className="h-9 w-9"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {exercise.notes ? (
                    <div className="text-sm text-muted-foreground mt-3 whitespace-pre-wrap">{exercise.notes}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>{editingExercise ? 'Edit Exercise' : 'Add Exercise'}</DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">Name</label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Exercise name"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-1">Muscle Group</label>
                    <select
                      value={formData.muscle_group}
                      onChange={(e) => setFormData({ ...formData, muscle_group: e.target.value })}
                      className="h-10 w-full rounded-xl border border-border bg-input px-3 text-sm text-foreground"
                    >
                      <option value="">None</option>
                      {MUSCLE_GROUPS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground/80 mb-1">Equipment</label>
                    <select
                      value={formData.equipment}
                      onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
                      className="h-10 w-full rounded-xl border border-border bg-input px-3 text-sm text-foreground"
                    >
                      <option value="">Any</option>
                      {EQUIPMENT_OPTIONS.map((eq) => (
                        <option key={eq} value={eq}>
                          {eq}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">Technique</label>
                  <Input
                    value={formData.technique}
                    onChange={(e) => setFormData({ ...formData, technique: e.target.value })}
                    placeholder="Optional"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">Notes</label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Optional notes..."
                    className="w-full min-h-[84px] rounded-xl border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">Default Technique Tags</label>
                  <div className="flex flex-wrap gap-2">
                    {TECHNIQUE_TAGS.map((tag) => {
                      const active = (formData.default_technique_tags || []).includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => {
                            const current = formData.default_technique_tags || [];
                            setFormData({
                              ...formData,
                              default_technique_tags: active
                                ? current.filter((t) => t !== tag)
                                : [...current, tag],
                            });
                          }}
                          className={[
                            'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                            active
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
                          ].join(' ')}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="surface p-4">
                  <div className="text-sm font-medium text-foreground mb-3">Default Set Scheme</div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Sets</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.default_set_scheme?.sets || 0}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            default_set_scheme: { ...formData.default_set_scheme, sets: parseInt(e.target.value) || 0 },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Reps</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.default_set_scheme?.reps || 0}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            default_set_scheme: { ...formData.default_set_scheme, reps: parseInt(e.target.value) || 0 },
                          })
                        }
                      />
                    </div>

                    {/* ✅ THIS is now the real rest timer field */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Rest (seconds)</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.rest_seconds}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            rest_seconds: parseInt(e.target.value) || 0,
                          })
                        }
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Notes</label>
                      <Input
                        type="text"
                        value={formData.default_set_scheme?.notes || ''}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            default_set_scheme: { ...formData.default_set_scheme, notes: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>

                  <p className="mt-3 text-xs text-muted-foreground">
                    This rest value is used during workouts as the default rest timer for this exercise.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setIsDialogOpen(false);
                      setEditingExercise(null);
                      resetForm();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button onClick={handleSave}>{editingExercise ? 'Save' : 'Create'}</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        <Navigation />
      </div>
    </AuthGuard>
  );
}
