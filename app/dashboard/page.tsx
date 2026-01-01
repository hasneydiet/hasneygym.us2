'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { WorkoutSession } from '@/lib/types';
import { Play, Dumbbell, Calendar, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const router = useRouter();
  const [recentSessions, setRecentSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecentSessions();
  }, []);

  const loadRecentSessions = async () => {
    try {
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('*, routines(name), routine_days(name)')
        .order('started_at', { ascending: false })
        .limit(5);

      if (error) throw error;
      setRecentSessions(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGuard>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
        <Navigation />
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-6">Dashboard</h1>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <button
              onClick={() => router.push('/workout/start')}
              className="bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 p-6 rounded-lg hover:bg-gray-800 dark:hover:bg-gray-200 transition-colors flex flex-col items-center justify-center space-y-2 min-h-[120px]"
            >
              <Play className="w-8 h-8" />
              <span className="font-medium">Start Workout</span>
            </button>

            <button
              onClick={() => router.push('/exercises')}
              className="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 p-6 rounded-lg hover:border-gray-900 dark:hover:border-gray-300 transition-colors flex flex-col items-center justify-center space-y-2 min-h-[120px]"
            >
              <Dumbbell className="w-8 h-8" />
              <span className="font-medium">Exercises</span>
            </button>

            <button
              onClick={() => router.push('/routines')}
              className="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 p-6 rounded-lg hover:border-gray-900 dark:hover:border-gray-300 transition-colors flex flex-col items-center justify-center space-y-2 min-h-[120px]"
            >
              <Calendar className="w-8 h-8" />
              <span className="font-medium">Routines</span>
            </button>

            <button
              onClick={() => router.push('/history')}
              className="bg-white dark:bg-gray-900 border-2 border-gray-200 dark:border-gray-700 p-6 rounded-lg hover:border-gray-900 dark:hover:border-gray-300 transition-colors flex flex-col items-center justify-center space-y-2 min-h-[120px]"
            >
              <TrendingUp className="w-8 h-8" />
              <span className="font-medium">History</span>
            </button>
          </div>

          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">Recent Workouts</h2>

            {loading ? (
              <p className="text-gray-500 dark:text-gray-400">Loading...</p>
            ) : recentSessions.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">No workouts yet. Start your first workout!</p>
            ) : (
              <div className="space-y-3">
                {recentSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => router.push(`/history/${session.id}`)}
                    className="w-full text-left p-4 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-gray-900 dark:hover:border-gray-300 transition-colors"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-900 dark:text-gray-100">
                          {session.routines?.name || 'Quick Workout'}
                        </p>
                        {session.routine_days?.name && (
                          <p className="text-sm text-gray-600 dark:text-gray-400">{session.routine_days.name}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {format(new Date(session.started_at), 'MMM d, yyyy')}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-500">
                          {format(new Date(session.started_at), 'h:mm a')}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthGuard>
  );
}
