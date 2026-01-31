'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Exercise, TECHNIQUE_TAGS } from '@/lib/types';
import { normalizeMuscleGroup, CANONICAL_MUSCLE_GROUPS } from '@/lib/muscleGroups';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Edit2, Trash2, TrendingUp } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default function ExercisesPage() {
  const router = useRouter();
  const { isCoach } = useCoach();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState('');

  useEffect(() => {
    loadExercises();
  }, []);

  const loadExercises = async () => {
    const { data } = await supabase
      .from('exercises')
      .select('*')
      .order('name');

    setExercises(data || []);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this exercise?')) return;
    await supabase.from('exercises').delete().eq('id', id);
    loadExercises();
  };

  const filteredExercises = exercises.filter((ex) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      !q ||
      ex.name.toLowerCase().includes(q) ||
      (ex.muscle_group || '').toLowerCase().includes(q);

    const matchesGroup =
      !selectedMuscleGroup ||
      normalizeMuscleGroup(ex.muscle_group) === normalizeMuscleGroup(selectedMuscleGroup);

    return matchesSearch && matchesGroup;
  });

  return (
    <AuthGuard>
      <div className="app-shell">
        <Navigation />

        <div className="page max-w-none">
          <div className="flex justify-between items-center mb-6">
            <h1 className="page-title">Exercises</h1>

            <Input
              placeholder="Search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="max-w-xs"
            />
          </div>

          <div className="surface overflow-hidden">
            <table className="w-full">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="hidden md:table-cell">Muscle</th>
                  <th className="hidden md:table-cell">Equipment</th>
                  <th />
                </tr>
              </thead>

              <tbody>
                {filteredExercises.map((exercise) => (
                  <tr key={exercise.id}>
                    <td>{exercise.name}</td>
                    <td className="hidden md:table-cell">
                      {normalizeMuscleGroup(exercise.muscle_group)}
                    </td>
                    <td className="hidden md:table-cell">
                      {exercise.equipment || '-'}
                    </td>
                    <td className="text-right">
                      <button
                        onClick={() => router.push(`/exercises/${exercise.id}`)}
                        className="icon-btn"
                      >
                        <TrendingUp />
                      </button>
                      <button
                        onClick={() => handleDelete(exercise.id)}
                        className="icon-btn text-destructive"
                      >
                        <Trash2 />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredExercises.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                No exercises found
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
