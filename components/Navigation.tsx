'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Dumbbell, Calendar, History, LogOut, Sun, Moon, Play, Users } from 'lucide-react';
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
        { href: '/workout/start', icon: Play, label: 'Workout' },
        { href: '/exercises', icon: Dumbbell, label: 'Exercises' },
        { href: '/routines', icon: Calendar, label: 'Routines' },
        { href: '/history', icon: History, label: 'History' },
      ];

  // Mobile performance: aggressively prefetch tab routes so switching tabs
  // doesn't wait on route chunk downloads over slower connections.
  useEffect(() => {
    const hrefs = navItems.map((n) => n.href);

    const doPrefetch = () => {
      try {
        hrefs.forEach((h) => router.prefetch(h));
      } catch {
        // Prefetch is a best-effort optimization; ignore failures.
      }
    };

    // Prefer idle time so we don't compete with initial rendering.
    const w = typeof window !== 'undefined' ? (window as any) : null;
    if (w && typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(doPrefetch, { timeout: 1500 });
      return () => {
        try {
          w.cancelIdleCallback?.(id);
        } catch {}
      };
    }

    const t = setTimeout(doPrefetch, 400);
    return () => clearTimeout(t);
  }, [router, isCoach, impersonateUserId]);


  const isActive = (href: string) => {
    if (href === '/workout/start') return pathname === '/' || pathname.startsWith('/workout');
    return pathname === href || pathname.startsWith(href + '/');
  };

  return (
    <>
      {/* HEADER (mobile + desktop) */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background bg-opacity-85 backdrop-blur supports-[backdrop-filter]:bg-background supports-[backdrop-filter]:bg-opacity-70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 md:h-16">
            {/* Logo (no square background) */}
            <BrandLogo href="/workout/start" iconSize={28} showTagline={true} taglineOnMobile={false} />

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
