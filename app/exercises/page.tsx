'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Exercise, TECHNIQUE_TAGS } from '@/lib/types';
import { Plus, Search, Edit2, Trash2, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Non-breaking: HTML datalist suggestions keep inputs free-form while providing a fast picker on mobile/desktop.
const MUSCLE_GROUP_OPTIONS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Abs',
  'Obliques',
  'Traps',
  'Lats',
  'Lower Back',
  'Glutes',
  'Quads',
  'Hamstrings',
  'Calves',
  'Adductors',
  'Abductors',
  'Hip Flexors',
  'Full Body',
  'Cardio',
];

const EQUIPMENT_OPTIONS = [
  'Dumbbell',
  'Barbell',
  'Machine',
  'Smith Machine',
  'Cables',
  'Kettlebell',
  'Body Weight',
  'Resistance Bands',
];

// The native <datalist> UI cannot be reliably themed across browsers.
// This lightweight autocomplete keeps the field free-form (non-breaking behavior)
// while rendering a premium, theme-colored suggestion menu.
function AutocompleteInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  options: string[];
}) {
  const { label, value, onChange, placeholder, options } = props;
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [value, options]);

  // Close when clicking outside.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <label className="block text-sm font-medium text-foreground/80 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full h-11 px-3 rounded-xl border border-input bg-background bg-opacity-70 backdrop-blur text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
        autoComplete="off"
      />

      {open && filtered.length > 0 && (
        <div
          className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-border/70 bg-primary text-primary-foreground shadow-lg"
          role="listbox"
        >
          <div className="max-h-64 overflow-auto py-1">
            {filtered.map((opt) => (
              <button
                key={opt}
                type="button"
                role="option"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-primary/80 focus:bg-primary/80 focus:outline-none"
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const dynamic = 'force-dynamic';

export default function ExercisesPage() {
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    muscle_group: '',
    equipment: '',
    notes: '',
    rest_seconds: 60,
    default_technique_tags: [] as string[],
    default_set_scheme: null as { sets?: number; reps?: number; restSeconds?: number; notes?: string } | null,
  });

  useEffect(() => {
    loadExercises();
  }, []);

  const loadExercises = async () => {
    const { data, error } = await supabase
      .from('exercises')
      .select('*')
      .order('name');

    if (!error && data) {
      setExercises(data);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizeEquipment = (v: string) => v.trim().toLowerCase();

    const payload = {
      name: formData.name,
      muscle_group: formData.muscle_group,
      equipment: normalizeEquipment(formData.equipment),
      notes: formData.notes,
      rest_seconds: Number.isFinite(formData.rest_seconds) ? Math.max(0, Math.floor(formData.rest_seconds)) : 60,
      default_technique_tags: formData.default_technique_tags,
      default_set_scheme: formData.default_set_scheme && formData.default_set_scheme.sets ? formData.default_set_scheme : null,
    };

    if (editingExercise) {
      await supabase
        .from('exercises')
        .update(payload)
        .eq('id', editingExercise.id);
    } else {
      await supabase.from('exercises').insert(payload);
    }

    setFormData({
      name: '',
      muscle_group: '',
      equipment: '',
      notes: '',
      rest_seconds: 60,
      default_technique_tags: [],
      default_set_scheme: null,
    });
    setShowForm(false);
    setEditingExercise(null);
    loadExercises();
  };

  const handleEdit = (exercise: Exercise) => {
    setEditingExercise(exercise);
    setFormData({
      name: exercise.name,
      muscle_group: exercise.muscle_group || '',
      equipment: exercise.equipment || '',
      notes: exercise.notes || '',
      rest_seconds: exercise.rest_seconds ?? 60,
      default_technique_tags: exercise.default_technique_tags || [],
      default_set_scheme: exercise.default_set_scheme || null,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this exercise?')) return;

    await supabase.from('exercises').delete().eq('id', id);
    loadExercises();
  };

  const toggleTechniqueTag = (tag: string) => {
    setFormData((prev) => {
      const exists = prev.default_technique_tags.includes(tag);
      return {
        ...prev,
        default_technique_tags: exists
          ? prev.default_technique_tags.filter((t) => t !== tag)
          : [...prev.default_technique_tags, tag],
      };
    });
  };

  const filteredExercises = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return exercises.filter((exercise) => {
      const matchesSearch =
        !term ||
        exercise.name.toLowerCase().includes(term) ||
        (exercise.muscle_group || '').toLowerCase().includes(term) ||
        (exercise.equipment || '').toLowerCase().includes(term) ||
        (exercise.notes || '').toLowerCase().includes(term);

      const matchesMuscleGroup = !selectedMuscleGroup || exercise.muscle_group === selectedMuscleGroup;

      return matchesSearch && matchesMuscleGroup;
    });
  }, [exercises, searchTerm, selectedMuscleGroup]);

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
                setFormData({
                  name: '',
                  muscle_group: '',
                  equipment: '',
                  notes: '',
                  rest_seconds: 60,
                  default_technique_tags: [],
                  default_set_scheme: null,
                });
                setShowForm(true);
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
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search exercises..."
                  className="pl-9"
                />
              </div>

              <Select
                value={selectedMuscleGroup}
                onValueChange={(v) => setSelectedMuscleGroup(v === '__all__' ? '' : v)}
              >
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="All muscle groups" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All muscle groups</SelectItem>
                  {MUSCLE_GROUP_OPTIONS.map((mg) => (
                    <SelectItem key={mg} value={mg}>
                      {mg}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {showForm && (
            <div className="surface p-5 sm:p-6 mb-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Exercise Name
                  </label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="E.g., Bench Press"
                  />
                </div>

                <AutocompleteInput
                  label="Muscle Group"
                  value={formData.muscle_group}
                  onChange={(v) => setFormData({ ...formData, muscle_group: v })}
                  placeholder="E.g., Chest, Back, Legs"
                  options={MUSCLE_GROUP_OPTIONS}
                />

                <AutocompleteInput
                  label="Equipment"
                  value={formData.equipment}
                  onChange={(v) => setFormData({ ...formData, equipment: v })}
                  placeholder="E.g., Dumbbell, Barbell, Machine"
                  options={EQUIPMENT_OPTIONS}
                />

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

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">
                    Default Technique Tags
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {TECHNIQUE_TAGS.map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => toggleTechniqueTag(tag)}
                        className={`tap-target min-h-8 px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                          formData.default_technique_tags.includes(tag)
                            ? 'bg-primary text-primary-foreground border-primary/30 shadow-sm'
                            : 'bg-secondary/70 text-secondary-foreground border-border/60 hover:bg-secondary'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-2">
                    Default Set Scheme
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Sets</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.default_set_scheme?.sets || 0}
                        onChange={(e) => setFormData({
                          ...formData,
                          default_set_scheme: { ...formData.default_set_scheme, sets: parseInt(e.target.value) || 0 },
                        })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Reps</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.default_set_scheme?.reps || 0}
                        onChange={(e) => setFormData({
                          ...formData,
                          default_set_scheme: { ...formData.default_set_scheme, reps: parseInt(e.target.value) || 0 },
                        })}
                      />
                    </div>

                    {/* ✅ Rest timer input moved here and now controls exercises.rest_seconds */}
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Rest (seconds)</label>
                      <Input
                        type="number"
                        min="0"
                        value={formData.rest_seconds}
                        onChange={(e) => setFormData({
                          ...formData,
                          rest_seconds: parseInt(e.target.value) || 0,
                        })}
                      />
                    </div>

                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Notes</label>
                      <Input
                        type="text"
                        value={formData.default_set_scheme?.notes || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          default_set_scheme: { ...formData.default_set_scheme, notes: e.target.value },
                        })}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button type="submit" className="flex-1">
                    {editingExercise ? 'Update' : 'Create'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowForm(false);
                      setEditingExercise(null);
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          )}

          {!showForm && (
            <>
              {filteredExercises.length === 0 ? (
                <div className="surface p-6 text-center">
                  <div className="text-sm text-muted-foreground">No exercises found.</div>
                </div>
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
                          <div className="text-xs text-muted-foreground mt-1">Rest: {exercise.rest_seconds ?? 60}s</div>
                        </div>

                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(exercise)}
                            className="h-9 w-9"
                          >
                            <Edit2 className="h-4 w-4" />
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

              <div className="mt-6">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => router.push('/coach')}
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Coach Area
                </Button>
              </div>
            </>
          )}
        </div>

        <Navigation />
      </div>
    </AuthGuard>
  );
}
