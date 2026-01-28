'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Button } from '@/components/ui/button';
import { COACH_IMPERSONATE_EMAIL_KEY } from '@/lib/coach';
import { cacheGet, cacheSet } from '@/lib/perfCache';

export const dynamic = 'force-dynamic';

type CoachUserRow = {
  id: string;
  email: string | null;
};

export default function CoachPage() {
  const router = useRouter();
  const { isCoach, ready, setImpersonateUserId } = useCoach();
  const [users, setUsers] = useState<CoachUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [libraryStatus, setLibraryStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const getAccessToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token || null;
  };

  // Excel-friendly CSV export/import helpers for the exercise library.
  const csvEscape = (v: any) => {
    const s = v === null || v === undefined ? '' : String(v);
    const needsQuotes = /[",\n\r\t]/.test(s);
    const escaped = s.replace(/"/g, '""');
    return needsQuotes ? `"${escaped}"` : escaped;
  };

  const exercisesToCsv = (rows: any[]) => {
    const headers = [
      'name',
      'muscle_group',
      'equipment',
      'notes',
      'rest_seconds',
      'default_technique_tags',
      'default_set_scheme_sets',
      'default_set_scheme_reps',
      'default_set_scheme_restSeconds',
      'default_set_scheme_notes',
    ];

    const lines = [headers.join(',')];
    for (const r of rows || []) {
      const scheme = (r?.default_set_scheme && typeof r.default_set_scheme === 'object') ? r.default_set_scheme : {};
      const tags = Array.isArray(r?.default_technique_tags) ? r.default_technique_tags.join(';') : (r?.default_technique_tags || '');
      const values = [
        r?.name,
        r?.muscle_group,
        r?.equipment,
        r?.notes,
        r?.rest_seconds,
        tags,
        scheme?.sets,
        scheme?.reps,
        scheme?.restSeconds,
        scheme?.notes,
      ].map(csvEscape);
      lines.push(values.join(','));
    }

    // Add UTF-8 BOM so Excel opens it cleanly.
    return `\uFEFF${lines.join('\n')}`;
  };

  const parseCsv = (text: string) => {
    // Minimal CSV parser (supports quotes + commas). Returns array of objects keyed by header.
    const rows: string[][] = [];
    let i = 0;
    const s = text.replace(/^\uFEFF/, '');
    const len = s.length;
    const nextRow = () => {
      const row: string[] = [];
      let field = '';
      let inQuotes = false;
      while (i < len) {
        const ch = s[i];
        if (inQuotes) {
          if (ch === '"') {
            if (s[i + 1] === '"') {
              field += '"';
              i += 2;
              continue;
            }
            inQuotes = false;
            i++;
            continue;
          }
          field += ch;
          i++;
          continue;
        }
        if (ch === '"') {
          inQuotes = true;
          i++;
          continue;
        }
        if (ch === ',') {
          row.push(field);
          field = '';
          i++;
          continue;
        }
        if (ch === '\n') {
          row.push(field);
          i++;
          break;
        }
        if (ch === '\r') {
          // handle CRLF
          row.push(field);
          i++;
          if (s[i] === '\n') i++;
          break;
        }
        field += ch;
        i++;
      }
      // last line (EOF)
      if (i >= len) row.push(field);
      return row;
    };

    while (i < len) {
      const row = nextRow();
      if (row.length === 1 && row[0] === '' && i >= len) break;
      rows.push(row);
    }

    if (rows.length === 0) return [];
    const headers = rows[0].map((h) => h.trim());
    const out: any[] = [];
    for (let r = 1; r < rows.length; r++) {
      const line = rows[r];
      if (line.every((v) => (v ?? '').trim() === '')) continue;
      const obj: any = {};
      for (let c = 0; c < headers.length; c++) obj[headers[c]] = line[c] ?? '';
      out.push(obj);
    }
    return out;
  };

  const handleExportLibrary = async () => {
    setLibraryStatus(null);
    const token = await getAccessToken();
    if (!token) {
      setLibraryStatus('No session token found.');
      return;
    }

    try {
      const res = await fetch('/api/coach/library/export', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setLibraryStatus(json?.error || 'Export failed.');
        return;
      }

      const payload = json?.library ?? json;
      const rows = Array.isArray((payload as any)?.exercises) ? (payload as any).exercises : [];

      const csv = exercisesToCsv(rows);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `exercises-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLibraryStatus('Exported exercises CSV (Excel-friendly).');
    } catch (e: any) {
      setLibraryStatus(e?.message || 'Export failed.');
    }
  };

  const handlePickImportFile = () => {
    setLibraryStatus(null);
    fileInputRef.current?.click();
  };

  const handleImportFileChosen = async (file: File | null) => {
    if (!file) return;
    setLibraryStatus(null);

    const token = await getAccessToken();
    if (!token) {
      setLibraryStatus('No session token found.');
      return;
    }

    try {
      const text = await file.text();
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const parsed = isCsv ? null : JSON.parse(text);

      // If CSV, convert to the JSON payload the existing import endpoint expects.
      const csvPayload = isCsv
        ? (() => {
            const rows = parseCsv(text);
            const exercises = rows.map((r: any) => {
              const tags = (r.default_technique_tags || '')
                .split(';')
                .map((t: string) => t.trim())
                .filter(Boolean);

              const toInt = (v: any) => {
                const n = parseInt(String(v ?? '').trim(), 10);
                return Number.isFinite(n) ? n : null;
              };

              const sets = toInt(r.default_set_scheme_sets);
              const reps = toInt(r.default_set_scheme_reps);
              const restSeconds = toInt(r.default_set_scheme_restSeconds);
              const schemeNotes = String(r.default_set_scheme_notes || '').trim();
              const default_set_scheme = sets ? {
                sets,
                reps: reps ?? 0,
                restSeconds: restSeconds ?? 0,
                notes: schemeNotes || null,
              } : null;

              return {
                name: String(r.name || '').trim(),
                muscle_group: String(r.muscle_group || '').trim() || null,
                equipment: String(r.equipment || '').trim() || null,
                notes: String(r.notes || '').trim() || null,
                rest_seconds: toInt(r.rest_seconds) ?? 60,
                default_technique_tags: tags,
                default_set_scheme,
              };
            }).filter((e: any) => e.name);

            return { exercises };
          })()
        : null;

      const body = isCsv ? csvPayload : parsed;

      const res = await fetch('/api/coach/library/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLibraryStatus(json?.error || 'Import failed.');
        return;
      }

      setLibraryStatus(isCsv ? 'Imported exercises from CSV successfully.' : 'Imported library successfully.');
    } catch (e: any) {
      setLibraryStatus(e?.message || 'Import failed.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!isCoach) return;

    const cacheKey = 'coach:users:v1';
    // Fast path: show cached users immediately for faster tab switching.
    const cached = cacheGet<CoachUserRow[]>(cacheKey);
    if (cached && Array.isArray(cached) && cached.length) {
      setUsers(cached);
      setLoading(false);
    }

    const load = async (silent?: boolean) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }

      // Fetch via server-side endpoint (uses service role key on the server).
      const token = await getAccessToken();
      if (!token) {
        setError('No session token found.');
        setUsers([]);
        if (!silent) setLoading(false);
        return;
      }

      try {
        const res = await fetch('/api/coach/users', {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const json = await res.json().catch(() => ({}));

        if (!res.ok) {
          setError(json?.error || 'Failed to load users.');
          setUsers([]);
        } else {
          const rows = (json?.users || []) as CoachUserRow[];
          setUsers(rows);
          cacheSet(cacheKey, rows, 30 * 1000);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load users.');
        setUsers([]);
      }
      if (!silent) setLoading(false);
    };

    // If we had cached data, refresh in the background.
    if (cached && Array.isArray(cached) && cached.length) {
      const w = typeof window !== 'undefined' ? (window as any) : null;
      const refresh = () => load(true);
      if (w && typeof w.requestIdleCallback === 'function') {
        w.requestIdleCallback(refresh, { timeout: 1200 });
      } else {
        setTimeout(refresh, 250);
      }
    } else {
      load(false);
    }
  }, [isCoach]);

  useEffect(() => {
    // Client-side guard (DB enforces the real authorization).
    if (ready && isCoach === false) {
      router.replace('/history');
    }
  }, [ready, isCoach, router]);

  const handleOpenUser = (userId: string, email: string | null) => {
    // Store email for a lightweight UI indicator in the header while impersonating.
    if (typeof window !== 'undefined') {
      if (email) window.localStorage.setItem(COACH_IMPERSONATE_EMAIL_KEY, email);
      else window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
    }
    setImpersonateUserId(userId);
    router.push('/history');
  };

  return (
    <AuthGuard>
      <Navigation />
      <main className="page">
        <div className="page-container">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="page-title">Coach</h1>
              <p className="page-subtitle mt-1">Select a user to view and edit their workouts and routines.</p>
            </div>

            <div className="flex gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,text/csv,.csv"
                className="hidden"
                onChange={(e) => handleImportFileChosen(e.target.files?.[0] || null)}
              />
              <Button variant="outline" onClick={handleExportLibrary}>
                Export Library
              </Button>
              <Button onClick={handlePickImportFile}>Import Library</Button>
            </div>
          </div>

          {libraryStatus && (
            <div className="mb-4 text-sm text-muted-foreground">{libraryStatus}</div>
          )}

          <div className="surface p-6 sm:p-7">
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading...</div>
            ) : error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : users.length === 0 ? (
              <div className="text-sm text-muted-foreground">No users found.</div>
            ) : (
              <div className="space-y-2">
                {users.map((u) => (
                  <div key={u.id} className="flex items-center justify-between gap-3 border border-border rounded-lg p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{u.email || u.id}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.id}</div>
                    </div>
                    <Button onClick={() => handleOpenUser(u.id, u.email)} className="shrink-0">
                      Open
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </AuthGuard>
  );
}
