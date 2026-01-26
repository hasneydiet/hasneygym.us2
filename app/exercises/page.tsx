'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Exercise, TECHNIQUE_TAGS } from '@/lib/types';
import { CANONICAL_MUSCLE_GROUPS, normalizeMuscleGroup } from '@/lib/muscleGroups';
import { cacheGet, cacheSet } from '@/lib/perfCache';
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

// Keep muscle groups consistent across the app.
// Inputs remain free-form; this only standardizes the picker options.
const MUSCLE_GROUP_OPTIONS = CANONICAL_MUSCLE_GROUPS;

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
    // Mobile performance: render the cached exercise list immediately (if present)
    // so switching tabs doesn't feel like a full reload. Then revalidate in background.
    const cacheKey = 'exercises:all:v1';
    const cached = cacheGet<Exercise[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      setExercises(cached);
      const w = typeof window !== 'undefined' ? (window as any) : null;
      const refresh = () => loadExercises({ cacheKey, silent: true });
      if (w && typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(refresh, { timeout: 1200 });
      } else {
        setTimeout(refresh, 250);
      }
      return;
    }

    loadExercises({ cacheKey });
  }, []);

  const loadExercises = async (opts?: { cacheKey?: string; silent?: boolean }) => {
    const cacheKey = opts?.cacheKey || 'exercises:all:v1';
    const { data, error } = await supabase
      .from('exercises')
      .select('*')
      .order('name');

    if (!error && data) {
      setExercises(data);
      // Short-lived cache (2 minutes) to speed up back-and-forth navigation.
      cacheSet(cacheKey, data as any, 2 * 60 * 1000);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizeEquipment = (v: string) => v.trim().toLowerCase();

    const payload = {
      name: formData.name,
      muscle_group: normalizeMuscleGroup(formData.muscle_group),
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
      muscle_group: exercise.muscle_group,
      equipment: exercise.equipment,
      notes: exercise.notes,
      rest_seconds: (exercise as any).rest_seconds ?? 60,
      default_technique_tags: exercise.default_technique_tags || [],
      default_set_scheme: exercise.default_set_scheme || null,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this exercise?')) {
      await supabase.from('exercises').delete().eq('id', id);
      loadExercises();
    }
  };

  const toggleTechniqueTag = (tag: string) => {
    setFormData({
      ...formData,
      default_technique_tags: formData.default_technique_tags.includes(tag)
        ? formData.default_technique_tags.filter(t => t !== tag)
        : [...formData.default_technique_tags, tag],
    });
  };

  const filteredExercises = exercises.filter((ex) => {
    const matchesGroup = selectedMuscleGroup
      ? normalizeMuscleGroup(ex.muscle_group) === normalizeMuscleGroup(selectedMuscleGroup)
      : true;
    const q = searchTerm.trim().toLowerCase();
    const matchesSearch = !q
      ? true
      : ex.name.toLowerCase().includes(q) || (ex.muscle_group || '').toLowerCase().includes(q);
    return matchesGroup && matchesSearch;
  });

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page max-w-none">
          <div className="flex justify-between items-center mb-6">
            <h1 className="page-title">Exercises</h1>
            <Button
              onClick={() => {
                setShowForm(true);
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
              }}
              className="gap-2"
            >
              <Plus className="w-5 h-5" />
              <span>Add Exercise</span>
            </Button>
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <Input
                type="text"
                placeholder="Search exercises..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Muscle group filter (Hevy-style: dropdown) */}
          <div className="mb-6">
            <Select
              value={selectedMuscleGroup || '__all__'}
              onValueChange={(v) => setSelectedMuscleGroup(v === '__all__' ? '' : v)}
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue placeholder="All Muscles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All Muscles</SelectItem>
                {MUSCLE_GROUP_OPTIONS.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showForm && (
            <div className="surface p-6 mb-6">
              <h2 className="text-lg font-semibold tracking-tight mb-4">
                {editingExercise ? 'Edit Exercise' : 'New Exercise'}
              </h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Exercise Name *
                  </label>
                  <Input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
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

          {/*
            Table container
            - Keep the card within the viewport on mobile (no clipped edges)
            - Allow horizontal scroll *inside* the card if the table can't fit
          */}
          {/*
            On mobile we keep the table in a card.
            On desktop there's plenty of space, so we remove the boxed look.
          */}
          <div className="surface overflow-hidden w-full max-w-full md:bg-transparent md:border-0 md:shadow-none md:rounded-none md:overflow-visible">
            <div className="w-full max-w-full overflow-x-auto md:overflow-x-visible">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[70%] md:w-[44%]" />
                  <col className="hidden md:table-column w-[0%] md:w-[22%]" />
                  <col className="hidden md:table-column w-[0%] md:w-[22%]" />
                  <col className="w-[30%] md:w-[12%]" />
                </colgroup>
                <thead className="bg-muted/40 border-b border-border/60">
                  <tr>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs sm:text-sm font-medium text-muted-foreground">Name</th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs sm:text-sm font-medium text-muted-foreground hidden md:table-cell">Muscle Group</th>
                    <th className="px-3 sm:px-4 py-3 text-left text-xs sm:text-sm font-medium text-muted-foreground hidden md:table-cell">Equipment</th>
                    <th className="px-3 sm:px-4 py-3 text-right text-xs sm:text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredExercises.map((exercise) => (
                    <tr key={exercise.id} className="hover:bg-accent/30">
                      <td className="px-3 sm:px-4 py-3 text-sm font-medium text-foreground break-words">
                        {exercise.name}
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-sm text-muted-foreground break-words hidden md:table-cell">
                        {exercise.muscle_group || '-'}
                      </td>
                      <td className="px-3 sm:px-4 py-3 text-sm text-muted-foreground break-words hidden md:table-cell">
                        {(exercise.equipment || '-').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </td>
                      <td className="px-2 sm:px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            onClick={() => router.push(`/exercises/${exercise.id}`)}
                            className="icon-btn"
                            title="View Progress"
                            aria-label="View exercise progress"
                          >
                            <TrendingUp className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleEdit(exercise)}
                            className="icon-btn"
                            title="Edit"
                            aria-label="Edit exercise"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(exercise.id)}
                            className="icon-btn text-destructive hover:text-destructive"
                            title="Delete"
                            aria-label="Delete exercise"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredExercises.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  {searchTerm ? 'No exercises found' : 'No exercises yet. Create your first exercise!'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
