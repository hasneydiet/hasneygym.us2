'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { Routine } from '@/lib/types';
import { Plus, Edit2, Trash2 } from 'lucide-react';

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
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Routines</h1>
            <button
              onClick={() => setShowForm(true)}
              className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 flex items-center space-x-2"
            >
              <Plus className="w-5 h-5" />
              <span>New Routine</span>
            </button>
          </div>

          {showForm && (
            <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6 mb-6">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Create Routine</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Routine Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Notes
                  </label>
                  <textarea
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:ring-2 focus:ring-gray-900 dark:focus:ring-gray-100 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                  />
                </div>

                <div className="flex space-x-3">
                  <button
                    type="submit"
                    className="flex-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 py-2 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200"
                  >
                    Create & Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowForm(false)}
                    className="flex-1 bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 py-2 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {routines.map((routine) => (
              <div key={routine.id} className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6">
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">{routine.name}</h3>
                {routine.notes && (
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">{routine.notes}</p>
                )}
                <div className="flex space-x-2">
                  <button
                    onClick={() => router.push(`/routines/${routine.id}`)}
                    className="flex-1 bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 flex items-center justify-center space-x-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    <span>Edit</span>
                  </button>
                  <button
                    onClick={() => handleDelete(routine.id)}
                    className="bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400 px-4 py-2 rounded-lg hover:bg-red-100 dark:hover:bg-red-900"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {routines.length === 0 && !showForm && (
            <div className="text-center py-12 text-gray-500 dark:text-gray-400">
              No routines yet. Create your first routine!
            </div>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
