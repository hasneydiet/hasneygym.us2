'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Dumbbell, Calendar, History, LogOut, Sun, Moon, Play, Users } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useCoach } from '@/hooks/useCoach';
import BrandLogo from '@/components/BrandLogo';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { isCoach } = useCoach();

  // Prevent content from being hidden behind bottom tab bar
  useEffect(() => {
    const prev = document.body.style.paddingBottom;
    document.body.style.paddingBottom = '80px';
    return () => {
      document.body.style.paddingBottom = prev;
    };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const navItems = isCoach
    ? [
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
              return (
                <Link
                  key={item.href}
                  href={item.href}
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
