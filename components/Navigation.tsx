'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dumbbell, Calendar, History, LogOut, Sun, Moon, Play, Users, LayoutDashboard } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useCoach } from '@/hooks/useCoach';
import BrandLogo from '@/components/BrandLogo';
import { COACH_IMPERSONATE_EMAIL_KEY } from '@/lib/coach';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { isCoach, impersonateUserId, setImpersonateUserId } = useCoach();
  const [impersonatedEmail, setImpersonatedEmail] = useState<string | null>(null);

  // Prevent content from being hidden behind bottom tab bar
  useEffect(() => {
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = '80px';
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, []);

  // UI-only: show which user the coach is impersonating (email) next to the theme toggle.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isCoach || !impersonateUserId) {
      setImpersonatedEmail(null);
      return;
    }
    const email = window.localStorage.getItem(COACH_IMPERSONATE_EMAIL_KEY);
    setImpersonatedEmail(email ? String(email) : null);
  }, [isCoach, impersonateUserId]);

  const handleLogout = async () => {
    // Lazy-load Supabase client to keep the shared Navigation bundle lighter on mobile.
    const { supabase } = await import('@/lib/supabase');
    await supabase.auth.signOut();
    router.push('/login');
  };

  const isImpersonating = Boolean(isCoach && impersonateUserId);

  // Coach navigation:
  // - Coach (not impersonating): Exercises, Routines, Users
  // - Coach (impersonating a user): show user tabs (Workout/Exercises/Routines/History) + Users (to exit impersonation)
  const navItems = isCoach
    ? isImpersonating
      ? [
          { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
          { href: '/workout/start', icon: Play, label: 'Workout' },
          { href: '/exercises', icon: Dumbbell, label: 'Exercises' },
          { href: '/routines', icon: Calendar, label: 'Routines' },
          { href: '/history', icon: History, label: 'History' },
          { href: '/coach', icon: Users, label: 'Users' },
        ]
      : [
          { href: '/exercises', icon: Dumbbell, label: 'Exercises' },
          { href: '/routines', icon: Calendar, label: 'Routines' },
          { href: '/coach', icon: Users, label: 'Users' },
        ]
    : [
        { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
        { href: '/workout/start', icon: Play, label: 'Workout' },
        { href: '/exercises', icon: Dumbbell, label: 'Exercises' },
        { href: '/routines', icon: Calendar, label: 'Routines' },
        { href: '/history', icon: History, label: 'History' },
      ];

  // Mobile performance: prefetching helps tab switches, but doing it too early
  // can compete with the dashboard's first Supabase queries (especially on iOS Safari).
  // Strategy:
  // - Skip prefetch on slow/data-saver connections
  // - Delay until after the critical first render window
  // - Prefetch in two small stages (most-likely routes first)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Only prefetch when visible; avoid burning bandwidth in background.
    if (document.visibilityState !== 'visible') return;

    const conn: any = (navigator as any).connection;
    const saveData = Boolean(conn?.saveData);
    const effectiveType = String(conn?.effectiveType || '').toLowerCase();
    const isSlow = saveData || effectiveType.includes('2g') || effectiveType.includes('3g');
    if (isSlow) return;

    const hrefs = navItems.map((n) => n.href).filter((h) => h !== pathname);

    // Prefer likely next destinations first.
    const primary = hrefs.filter((h) => h === '/workout/start' || h === '/exercises');
    const secondary = hrefs.filter((h) => !primary.includes(h));

    let cancelled = false;
    const w: any = window as any;
    const cleanupFns: Array<() => void> = [];

    const safePrefetch = (list: string[]) => {
      if (cancelled) return;
      try {
        list.forEach((h) => router.prefetch(h));
      } catch {
        // best-effort
      }
    };

    const scheduleIdle = (fn: () => void, timeout: number) => {
      if (typeof w.requestIdleCallback === 'function') {
        const id = w.requestIdleCallback(fn, { timeout });
        return () => {
          try {
            w.cancelIdleCallback?.(id);
          } catch {}
        };
      }
      const t = window.setTimeout(fn, Math.min(2500, timeout));
      return () => window.clearTimeout(t);
    };

    // Delay a bit to avoid fighting the initial dashboard load.
    const t0 = window.setTimeout(() => {
      const cancelPrimary = scheduleIdle(() => safePrefetch(primary), 5000);
      const cancelSecondary = scheduleIdle(() => safePrefetch(secondary), 9000);

      const onVis = () => {
        if (document.visibilityState === 'hidden') {
          cancelPrimary();
          cancelSecondary();
        }
      };
      document.addEventListener('visibilitychange', onVis);

      // Cleanup for this stage
      cleanupFns.push(() => document.removeEventListener('visibilitychange', onVis));
      cleanupFns.push(cancelPrimary);
      cleanupFns.push(cancelSecondary);
    }, 1800);

    cleanupFns.push(() => window.clearTimeout(t0));

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
    };
  }, [router, pathname, isCoach, impersonateUserId]);


  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/' || pathname.startsWith('/dashboard');
    if (href === '/workout/start') return pathname.startsWith('/workout');
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <>
      {/* HEADER (mobile + desktop) */}
      <nav className="sticky top-0 z-50 pt-[env(safe-area-inset-top)] border-b border-border/60 bg-background bg-opacity-85 backdrop-blur supports-[backdrop-filter]:bg-background supports-[backdrop-filter]:bg-opacity-70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 md:h-16">
            {/* Logo (no square background) */}
            <BrandLogo href="/dashboard" iconSize={28} showTagline={true} taglineOnMobile={false} />

            {/* Desktop nav links ONLY */}
            <div className="hidden md:flex items-center gap-1 rounded-2xl border border-border/60 bg-card/60 p-1 backdrop-blur">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={
                    isImpersonating && item.href === '/coach'
                      ? (e) => {
                          e.preventDefault();
                          if (typeof window !== 'undefined') {
                            window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
                          }
                          setImpersonateUserId(null);
                          router.push('/coach');
                        }
                      : undefined
                  }
                  className={`px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
                    isActive(item.href)
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-foreground/80 hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>

            {/* Actions (mobile + desktop) */}
            <div className="flex items-center gap-2">
              {isImpersonating && impersonatedEmail ? (
                <div
                  className="max-w-[180px] sm:max-w-[240px] truncate text-xs font-medium text-foreground"
                  title={impersonatedEmail}
                  aria-label={`Impersonating ${impersonatedEmail}`}
                >
                  {impersonatedEmail}
                </div>
              ) : null}

              <button
                onClick={toggleTheme}
                className="icon-btn"
                title="Toggle theme"
                aria-label="Toggle theme"
              >
                {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </button>

              <button
                onClick={handleLogout}
                className="icon-btn"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* MOBILE BOTTOM TAB BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background bg-opacity-85 backdrop-blur supports-[backdrop-filter]:bg-background supports-[backdrop-filter]:bg-opacity-70">
        <div className="pb-[env(safe-area-inset-bottom)]">
          <div className="flex justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              const handleNavClick =
                isImpersonating && item.href === '/coach'
                  ? (e: React.MouseEvent) => {
                      e.preventDefault();
                      if (typeof window !== 'undefined') {
                        window.localStorage.removeItem(COACH_IMPERSONATE_EMAIL_KEY);
                      }
                      setImpersonateUserId(null);
                      router.push('/coach');
                    }
                  : undefined;

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={handleNavClick}
                  className={`tap-target flex flex-col items-center justify-center py-3 px-2 text-xs font-medium flex-1 transition-colors ${
                    active
                      ? 'text-primary border-t-2 border-primary'
                      : 'text-muted-foreground'
                  }`}
                >
                  <Icon className={`w-5 h-5 mb-1 ${active ? '' : 'opacity-90'}`} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </nav>
    </>
  );
}
