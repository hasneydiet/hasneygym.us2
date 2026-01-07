'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { WorkoutSession } from '@/lib/types';
import { Play, Dumbbell, Calendar, TrendingUp } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default function DashboardPage() {
  const router = useRouter();
  const { effectiveUserId } = useCoach();
  const [recentSessions, setRecentSessions] = useState<WorkoutSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRecentSessions();
  }, [effectiveUserId]);

  const loadRecentSessions = async () => {
    try {
      if (!effectiveUserId) return;
      const { data, error } = await supabase
        .from('workout_sessions')
        .select('*, routines(name), routine_days(name)')
        .eq('user_id', effectiveUserId)
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
      <div className="app-shell">
        <Navigation />
        <div className="page">
          <h1 className="page-title mb-2">Dashboard</h1>
          <p className="page-subtitle mb-6">Quick actions and your recent training history.</p>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
            <Button
              onClick={() => router.push('/workout/start')}
              className="tile flex flex-col items-center justify-center gap-2 min-h-[120px]"
            >
              <Play className="w-8 h-8" />
              <span className="font-medium">Start Workout</span>
            </Button>

            <Button
              onClick={() => router.push('/exercises')}
              variant="outline"
              className="tile flex flex-col items-center justify-center gap-2 min-h-[120px]"
            >
              <Dumbbell className="w-8 h-8" />
              <span className="font-medium">Exercises</span>
            </Button>

            <Button
              onClick={() => router.push('/routines')}
              variant="outline"
              className="tile flex flex-col items-center justify-center gap-2 min-h-[120px]"
            >
              <Calendar className="w-8 h-8" />
              <span className="font-medium">Routines</span>
            </Button>

            <Button
              onClick={() => router.push('/history')}
              variant="outline"
              className="tile flex flex-col items-center justify-center gap-2 min-h-[120px]"
            >
              <TrendingUp className="w-8 h-8" />
              <span className="font-medium">History</span>
            </Button>
          </div>

          <Card className="shadow-lg shadow-black/5">
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold tracking-tight mb-4">Recent Workouts</h2>

            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : recentSessions.length === 0 ? (
              <p className="text-muted-foreground">No workouts yet. Start your first workout!</p>
            ) : (
              <div className="space-y-3">
                {recentSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => router.push(`/history/${session.id}`)}
                    className="surface surface-hover w-full text-left p-4"
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium">
                          {session.routines?.name || 'Quick Workout'}
                        </p>
                        {session.routine_days?.name && (
                          <p className="text-sm text-muted-foreground">{session.routine_days.name}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(session.started_at), 'MMM d, yyyy')}
                        </p>
                        <p className="text-sm text-muted-foreground/80">
                          {format(new Date(session.started_at), 'h:mm a')}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AuthGuard>
  );
}
