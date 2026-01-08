'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import AuthGuard from '@/components/AuthGuard';
import Navigation from '@/components/Navigation';
import { supabase } from '@/lib/supabase';
import { useCoach } from '@/hooks/useCoach';
import { Button } from '@/components/ui/button';

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
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = `library-export-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setLibraryStatus('Exported library JSON.');
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
      const parsed = JSON.parse(text);

      const res = await fetch('/api/coach/library/import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(parsed),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLibraryStatus(json?.error || 'Import failed.');
        return;
      }

      setLibraryStatus('Imported library successfully.');
    } catch (e: any) {
      setLibraryStatus(e?.message || 'Import failed.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    if (!isCoach) return;
    const load = async () => {
      setLoading(true);
      setError(null);

      // Fetch via server-side endpoint (uses service role key on the server).
      const token = await getAccessToken();
      if (!token) {
        setError('No session token found.');
        setUsers([]);
        setLoading(false);
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
          setUsers((json?.users || []) as CoachUserRow[]);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load users.');
        setUsers([]);
      }
      setLoading(false);
    };

    load();
  }, [isCoach]);

  useEffect(() => {
    // Client-side guard (DB enforces the real authorization).
    if (ready && isCoach === false) {
      router.replace('/history');
    }
  }, [ready, isCoach, router]);

  const handleOpenUser = (userId: string) => {
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
                accept="application/json"
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
                    <Button onClick={() => handleOpenUser(u.id)} className="shrink-0">
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
