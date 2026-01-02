'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Exercise, TECHNIQUE_TAGS } from '@/lib/types';
import { Plus, Search, Edit2, Trash2, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function ExercisesPage() {
  const router = useRouter();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingExercise, setEditingExercise] = useState<Exercise | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    muscle_group: '',
    equipment: '',
    notes: '',
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

    const payload = {
      name: formData.name,
      muscle_group: formData.muscle_group,
      equipment: formData.equipment,
      notes: formData.notes,
      default_technique_tags: formData.default_technique_tags,
      default_set_scheme: formData.default_set_scheme && formData.default_set_scheme.sets ? formData.default_set_scheme : null,
    };

    if (editingExercise) {
      await supabase
        .from('exercises')
        .update(payload)
        .eq('id', editingExercise.id);
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('exercises').insert({
          ...payload,
          user_id: user.id,
        });
      }
    }

    setFormData({
      name: '',
      muscle_group: '',
      equipment: '',
      notes: '',
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

  const filteredExercises = exercises.filter(
    (ex) =>
      ex.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ex.muscle_group.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />
        <div className="page">
          <div className="flex justify-between items-center mb-6">
            <h1 className="page-title">Exercises</h1>
            <button
              onClick={() => {
                setShowForm(true);
                setEditingExercise(null);
                setFormData({
                  name: '',
                  muscle_group: '',
                  equipment: '',
                  notes: '',
                  default_technique_tags: [],
                  default_set_scheme: null,
                });
              }}
              className="tap-target inline-flex items-center gap-2 rounded-xl bg-primary text-primary-foreground px-4 py-2 shadow-sm transition-all hover:bg-primary/90 hover:shadow-md active:translate-y-px"
            >
              <Plus className="w-5 h-5" />
              <span>Add Exercise</span>
            </button>
          </div>

          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <input
                type="text"
                placeholder="Search exercises..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-input bg-background/70 backdrop-blur text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
              />
            </div>
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
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 rounded-xl border border-input bg-background/70 backdrop-blur text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Muscle Group
                  </label>
                  <input
                    type="text"
                    value={formData.muscle_group}
                    onChange={(e) => setFormData({ ...formData, muscle_group: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-input bg-background/70 backdrop-blur text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                    placeholder="e.g., Chest, Back, Legs"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Equipment
                  </label>
                  <input
                    type="text"
                    value={formData.equipment}
                    onChange={(e) => setFormData({ ...formData, equipment: e.target.value })}
                    className="w-full px-4 py-2 rounded-xl border border-input bg-background/70 backdrop-blur text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
                    placeholder="e.g., Barbell, Dumbbell, Machine"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 rounded-xl border border-input bg-background/70 backdrop-blur text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
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
                        className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                          formData.default_technique_tags.includes(tag)
                            ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                            : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
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
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Sets</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.default_set_scheme?.sets || 0}
                        onChange={(e) => setFormData({
                          ...formData,
                          default_set_scheme: { ...formData.default_set_scheme, sets: parseInt(e.target.value) || 0 },
                        })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Reps</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.default_set_scheme?.reps || 0}
                        onChange={(e) => setFormData({
                          ...formData,
                          default_set_scheme: { ...formData.default_set_scheme, reps: parseInt(e.target.value) || 0 },
                        })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Rest (seconds)</label>
                      <input
                        type="number"
                        min="0"
                        value={formData.default_set_scheme?.restSeconds || 0}
                        onChange={(e) => setFormData({
                          ...formData,
                          default_set_scheme: { ...formData.default_set_scheme, restSeconds: parseInt(e.target.value) || 0 },
                        })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Notes</label>
                      <input
                        type="text"
                        value={formData.default_set_scheme?.notes || ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          default_set_scheme: { ...formData.default_set_scheme, notes: e.target.value },
                        })}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    type="submit"
                    className="flex-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 py-2 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200"
                  >
                    {editingExercise ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowForm(false);
                      setEditingExercise(null);
                    }}
                    className="flex-1 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Name</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Muscle Group</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-700 dark:text-gray-300">Equipment</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-700 dark:text-gray-300">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {filteredExercises.map((exercise) => (
                    <tr key={exercise.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">{exercise.name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{exercise.muscle_group || '-'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-400">{exercise.equipment || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => router.push(`/exercises/${exercise.id}`)}
                          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mr-3"
                          title="View Progress"
                        >
                          <TrendingUp className="w-4 h-4 inline" />
                        </button>
                        <button
                          onClick={() => handleEdit(exercise)}
                          className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 mr-3"
                        >
                          <Edit2 className="w-4 h-4 inline" />
                        </button>
                        <button
                          onClick={() => handleDelete(exercise.id)}
                          className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredExercises.length === 0 && (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
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
