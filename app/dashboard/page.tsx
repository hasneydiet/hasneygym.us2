'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/Navigation';
import AuthGuard from '@/components/AuthGuard';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { sortRoutineDays } from '@/lib/routineDaySort';
import { cacheGet, cacheSet } from '@/lib/perfCache';
import { startWorkoutForDay } from '@/lib/startWorkout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { History } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export const dynamic = 'force-dynamic';

type DashboardDay = {
  id: string;
  routine_id: string;
  day_index: number;
  name: string;
  created_at: string;
  routineName: string;
};

type LastWorkout = {
  id: string;
  started_at: string;
  routine_day_id: string | null;
  routine_id: string | null;
  routineName: string;
  dayName: string | null;
};

type ProfileGoal = 'maintenance' | 'recomposition' | 'cut' | 'bulking';

type UserProfile = {
  id: string;
  full_name: string | null;
  goal: ProfileGoal | null;
  goal_start: string | null; // YYYY-MM-DD
  goal_end: string | null; // YYYY-MM-DD
  weight_lbs: number | null;
  body_fat_percent: number | null;
  avatar_url: string | null;
};

function formatDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}


function formatDateYMD(dateISO: string | null | undefined) {
  if (!dateISO) return '-';
  const d = new Date(dateISO);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function addMonthsISO(dateISO: string, months: number) {
  const d = new Date(dateISO + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  // Handle month rollover (e.g., Jan 31 + 1 month)
  if (d.getDate() !== day) d.setDate(0);
  return d.toISOString().slice(0, 10);
}

function goalLabel(goal: ProfileGoal) {
  switch (goal) {
    case 'maintenance':
      return 'Maintenance';
    case 'recomposition':
      return 'Recomposition';
    case 'cut':
      return 'Cut';
    case 'bulking':
      return 'Bulking';
    default:
      return goal;
  }
}

async function getAuthedUser() {
  const { data: sessData } = await supabase.auth.getSession();
  const session = sessData?.session ?? null;
  if (session?.user) return session.user;
  try {
    const res = await supabase.auth.getUser();
    if (res.error) return null;
    return res.data?.user ?? null;
  } catch {
    return null;
  }
}

export default function DashboardPage() {
  const router = useRouter();
  const { effectiveUserId } = useCoach();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [days, setDays] = useState<DashboardDay[]>([]);
  const [lastWorkout, setLastWorkout] = useState<LastWorkout | null>(null);
  const [starting, setStarting] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const [draftName, setDraftName] = useState('');
  const [draftGoal, setDraftGoal] = useState<ProfileGoal | 'none'>('none');
  const [draftStart, setDraftStart] = useState('');
  const [draftEnd, setDraftEnd] = useState('');
  const [draftWeight, setDraftWeight] = useState('');
  const [draftBodyFat, setDraftBodyFat] = useState('');
  const [draftAvatarUrl, setDraftAvatarUrl] = useState<string | null>(null);
  const [draftAvatarFile, setDraftAvatarFile] = useState<File | null>(null);

  const cacheKey = useMemo(() => {
    return effectiveUserId ? `dashboard:${effectiveUserId}:v2` : null;
  }, [effectiveUserId]);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);
      setError(null);

      try {
        const user = await getAuthedUser();
        if (!user) {
          router.replace('/login');
          return;
        }
        const uid = effectiveUserId ?? user.id;

        // Parallelize independent dashboard queries to reduce first-load latency on mobile.
        const [profRes, daysRes, lastRes] = await Promise.all([
          supabase
            .from('profiles')
            .select('id, full_name, goal, goal_start, goal_end, weight_lbs, body_fat_percent, avatar_url')
            .eq('id', uid)
            .maybeSingle(),
          supabase
            .from('routine_days')
            .select('id, routine_id, day_index, name, created_at, routines!inner(name, user_id)')
            .eq('routines.user_id', uid)
            .order('day_index', { ascending: true })
            .order('created_at', { ascending: true }),
          supabase
            .from('workout_sessions')
            .select('id, started_at, routine_day_id, routine_id, routines(name), routine_days(name)')
            .eq('user_id', uid)
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ]);

        if (profRes.error) throw profRes.error;
        if (daysRes.error) throw daysRes.error;
        if (lastRes.error) throw lastRes.error;

        const profRow = profRes.data;
        const prof: UserProfile | null = profRow
          ? {
              id: (profRow as any).id,
              full_name: (profRow as any).full_name ?? null,
              goal: ((profRow as any).goal as ProfileGoal | null) ?? null,
              goal_start: (profRow as any).goal_start ?? null,
              goal_end: (profRow as any).goal_end ?? null,
              weight_lbs: (profRow as any).weight_lbs ?? null,
              body_fat_percent: (profRow as any).body_fat_percent ?? null,
              avatar_url: (profRow as any).avatar_url ?? null,
            }
          : null;

        const dayRows = daysRes.data;
        const baseDays = sortRoutineDays(
          (dayRows || []).map((r: any) => ({
            id: r.id,
            routine_id: r.routine_id,
            day_index: r.day_index,
            name: r.name,
            created_at: r.created_at,
            routineName: r.routines?.name || 'Routine',
          }))
        ) as DashboardDay[];

        const lastRow = lastRes.data;

        const last: LastWorkout | null = lastRow
          ? {
              id: (lastRow as any).id,
              started_at: (lastRow as any).started_at,
              routine_day_id: (lastRow as any).routine_day_id ?? null,
              routine_id: (lastRow as any).routine_id ?? null,
              routineName: (lastRow as any).routines?.name || 'Workout',
              dayName: (lastRow as any).routine_days?.name ?? null,
            }
          : null;

        if (!mounted) return;
        setDays(baseDays);
        setLastWorkout(last);
        setProfile(prof);
        // Cache for a few minutes so reopening the app doesn't feel slow on mobile.
        if (cacheKey) cacheSet(cacheKey, { days: baseDays, lastWorkout: last, profile: prof }, 5 * 60 * 1000);
      } catch (e: any) {
        console.error(e);
        if (!mounted) return;
        setError(e?.message || 'Failed to load dashboard.');
        setDays([]);
        setLastWorkout(null);
        setProfile(null);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Fast path: show cached data immediately, then revalidate.
    if (cacheKey) {
      const cached = cacheGet<{ days: DashboardDay[]; lastWorkout: LastWorkout | null; profile: UserProfile | null }>(cacheKey);
      if (cached && cached.days) {
        setDays(cached.days || []);
        setLastWorkout(cached.lastWorkout ?? null);
        setProfile(cached.profile ?? null);
        setLoading(false);
        setTimeout(() => mounted && load(), 200);
      } else {
        load();
      }
    } else {
      load();
    }

    return () => {
      mounted = false;
    };
  }, [router, effectiveUserId, cacheKey]);

  const nextDay = useMemo(() => {
    if (!days.length) return null;
    if (!lastWorkout?.routine_day_id) return days[0];
    const idx = days.findIndex((d) => d.id === lastWorkout.routine_day_id);
    if (idx === -1) return days[0];
    return days[(idx + 1) % days.length];
  }, [days, lastWorkout]);

  const startNext = async () => {
    if (!nextDay) return;
    try {
      setStarting(true);
      setError(null);

      const user = await getAuthedUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      const uid = effectiveUserId ?? user.id;
      const sessionId = await startWorkoutForDay({
        userId: uid,
        routineId: nextDay.routine_id,
        routineDayId: nextDay.id,
      });
      router.push(`/workout/${sessionId}`);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to start workout.');
    } finally {
      setStarting(false);
    }
  };

  const openProfileEditor = () => {
    const p = profile;
    setDraftName(p?.full_name ?? '');
    setDraftGoal((p?.goal ?? 'none') as any);
    setDraftStart(p?.goal_start ?? '');
    setDraftEnd(p?.goal_end ?? (p?.goal_start ? addMonthsISO(p.goal_start, 3) : ''));
        setDraftWeight(p?.weight_lbs != null ? String(p.weight_lbs) : '');
        setDraftBodyFat(p?.body_fat_percent != null ? String(p.body_fat_percent) : '');
        setDraftAvatarUrl(p?.avatar_url ?? null);
    setDraftAvatarFile(null);
    setEditingProfile(true);
  };

  const onDraftStartChange = (v: string) => {
    setDraftStart(v);
    if (v) setDraftEnd(addMonthsISO(v, 3));
    else setDraftEnd('');
  };

  const saveProfile = async () => {
    try {
      setSavingProfile(true);
      setError(null);

      const user = await getAuthedUser();
      if (!user) {
        router.replace('/login');
        return;
      }
      const uid = effectiveUserId ?? user.id;

      let avatarUrlToSave: string | null = draftAvatarUrl;
      if (draftAvatarFile) {
        const ext = (draftAvatarFile.name.split('.').pop() || 'png').toLowerCase();
        const path = `${uid}/badge-${Date.now()}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from('avatars')
          .upload(path, draftAvatarFile, { upsert: true, contentType: draftAvatarFile.type || 'image/png' });

        if (upErr) throw upErr;

        const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
        avatarUrlToSave = pub?.publicUrl ?? null;
      }

      const goalToSave: ProfileGoal | null = draftGoal === 'none' ? null : (draftGoal as ProfileGoal);

      const payload: any = {
        full_name: draftName.trim() || null,
        goal: goalToSave,
        goal_start: draftStart || null,
        goal_end: draftEnd || null,
        weight_lbs: draftWeight.trim() ? Number(draftWeight) : null,
        body_fat_percent: draftBodyFat.trim() ? Number(draftBodyFat) : null,
        avatar_url: avatarUrlToSave,
      };

      // Use upsert so saving works even if the profile row doesn't exist yet.
      const { data: updated, error: updErr } = await supabase
        .from('profiles')
        .upsert(
          {
            id: uid,
            ...payload,
          },
          { onConflict: 'id' }
        )
        .select('id, full_name, goal, goal_start, goal_end, weight_lbs, body_fat_percent, avatar_url')
        .single();

      if (updErr) throw updErr;

      const newProfile: UserProfile = {
        id: (updated as any)?.id || uid,
        full_name: (updated as any)?.full_name ?? null,
        goal: ((updated as any)?.goal as ProfileGoal | null) ?? null,
        goal_start: (updated as any)?.goal_start ?? null,
        goal_end: (updated as any)?.goal_end ?? null,
        weight_lbs: (updated as any)?.weight_lbs ?? null,
        body_fat_percent: (updated as any)?.body_fat_percent ?? null,
        avatar_url: (updated as any)?.avatar_url ?? null,
      };

      setProfile(newProfile);
      if (cacheKey) cacheSet(cacheKey, { days, lastWorkout, profile: newProfile }, 5 * 60 * 1000);
      setEditingProfile(false);
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to save profile.');
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <AuthGuard>
      <div className="app-shell pb-24">
        <Navigation />

        <div className="page max-w-3xl">
          <h1 className="page-title mb-2">Dashboard</h1>
          <p className="page-subtitle mb-6">Your last workout and the next suggested day.</p>

          <Card className="shadow-lg shadow-black/5 overflow-hidden mb-6">
            <CardContent className="relative p-6">
              {/* soft accent */}
              <div className="pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(60%_70%_at_20%_0%,black,transparent)]">
                <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
                <div className="absolute -right-24 -bottom-24 h-72 w-72 rounded-full bg-sky-500/15 blur-3xl" />
              </div>

              <div className="relative flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    <div className="shrink-0">
                      {profile?.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={profile.avatar_url}
                          alt="Badge"
                          className="h-14 w-14 rounded-full object-cover border border-border shadow-sm"
                        />
                      ) : (
                        <div className="h-14 w-14 rounded-full border border-border bg-muted flex items-center justify-center text-muted-foreground text-sm shadow-sm">
                          Badge
                        </div>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="text-lg font-semibold tracking-tight">Profile</div>
                      <div className="text-lg font-semibold tracking-tight truncate">
                        {profile?.full_name || 'Not set'}
                      </div>

	                      <div className="mt-2 space-y-1">
                        <div className="text-lg font-semibold tracking-tight">
                          Goal: {profile?.goal ? goalLabel(profile.goal) : 'Not set'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Routine Start Date: {formatDateYMD(profile?.goal_start)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Routine End Date: {formatDateYMD(profile?.goal_end)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
	                    <div className="rounded-xl border border-border/60 bg-background/60 p-3 backdrop-blur">
	                      <div className="text-[11px] font-medium text-muted-foreground">Start Weight</div>
                      <div className="mt-1 text-sm font-semibold">
                        {profile?.weight_lbs != null ? `${profile.weight_lbs} lb` : 'Not set'}
                      </div>
                    </div>

	                    <div className="rounded-xl border border-border/60 bg-background/60 p-3 backdrop-blur">
	                      <div className="text-[11px] font-medium text-muted-foreground">Start Body Fat</div>
                      <div className="mt-1 text-sm font-semibold">
                        {profile?.body_fat_percent != null ? `${profile.body_fat_percent}%` : 'Not set'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="shrink-0">
                  <Button variant="outline" className="h-10 px-4" onClick={openProfileEditor}>
                    Edit
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {error && (
            <div className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          {loading ? (
            <div className="text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-4">
              <Card className="shadow-lg shadow-black/5">
                <CardContent className="p-6">
                  <h2 className="text-lg font-semibold tracking-tight mb-3">Last workout</h2>
                  {lastWorkout ? (
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{lastWorkout.routineName}</div>
                        {lastWorkout.dayName ? <div className="text-sm text-muted-foreground">{lastWorkout.dayName}</div> : null}
                        <div className="text-sm text-muted-foreground mt-2">{formatDateTime(lastWorkout.started_at)}</div>
                      </div>
                      <Button variant="outline" onClick={() => router.push('/history')} className="shrink-0">
                        <History className="w-4 h-4 mr-2" />
                        History
                      </Button>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No workouts yet. Start your first workout below.</div>
                  )}
                </CardContent>
              </Card>

              <div className="tile relative overflow-hidden p-5 sm:p-6">
                <div className="pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(50%_60%_at_20%_10%,black,transparent)]">
                  <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-2xl" />
                  <div className="absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-emerald-500/15 blur-2xl" />
                </div>

                <div className="relative">
                  <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Next suggested workout</h2>
                  {nextDay ? (
                    <>
                      <p className="text-sm text-muted-foreground mt-1">{nextDay.routineName}</p>
                      <p className="text-sm text-muted-foreground">{nextDay.name}</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground mt-1">Create routines first to see a suggestion.</p>
                  )}

                  <Button
                    disabled={!nextDay || starting}
                    onClick={startNext}
                    className="mt-4 w-full h-12 text-base font-semibold"
                  >
                    {starting ? 'Starting…' : 'Start Workout'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <Dialog open={editingProfile} onOpenChange={setEditingProfile}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit profile</DialogTitle>
              <DialogDescription>Update your badge and goal details.</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Badge picture</Label>
                <Input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setDraftAvatarFile(f);
                    if (f) setDraftAvatarUrl(URL.createObjectURL(f));
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="full_name">Name</Label>
                <Input id="full_name" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Your name" />
              </div>

              <div className="space-y-2">
                <Label>Goal</Label>
                <Select value={draftGoal} onValueChange={(v) => setDraftGoal(v as any)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select goal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                    <SelectItem value="recomposition">Recomposition</SelectItem>
                    <SelectItem value="cut">Cut</SelectItem>
                    <SelectItem value="bulking">Bulking</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="goal_start">Start date</Label>
                  <Input id="goal_start" type="date" value={draftStart} onChange={(e) => onDraftStartChange(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="goal_end">End date</Label>
                  <Input id="goal_end" type="date" value={draftEnd} readOnly />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="weight_lbs">Weight (lb)</Label>
                  <Input
                    id="weight_lbs"
                    inputMode="decimal"
                    value={draftWeight}
                    onChange={(e) => setDraftWeight(e.target.value)}
                    placeholder="e.g. 219"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="body_fat_percent">Body fat (%)</Label>
                  <Input
                    id="body_fat_percent"
                    inputMode="decimal"
                    value={draftBodyFat}
                    onChange={(e) => setDraftBodyFat(e.target.value)}
                    placeholder="e.g. 12.5"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingProfile(false)} disabled={savingProfile}>
                Cancel
              </Button>
              <Button onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? 'Saving…' : 'Done'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AuthGuard>
  );
}
