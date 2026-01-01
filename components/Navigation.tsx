'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Dumbbell, Calendar, History, LogOut, Sun, Moon, Play } from 'lucide-react';
import { useTheme } from '@/lib/theme';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();

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

  const navItems = [
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
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-14 md:h-16">
            {/* Logo */}
            <Link href="/workout/start" className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-gray-900 dark:bg-gray-100 flex items-center justify-center">
                <Dumbbell className="w-5 h-5 text-white dark:text-gray-900" />
              </div>
              <div className="leading-tight">
                <div className="text-sm md:text-lg font-bold text-gray-900 dark:text-white">
                  HasneyGym
                </div>
                <div className="hidden md:block text-xs text-gray-500 dark:text-gray-400">
                  Workout Tracker
                </div>
              </div>
            </Link>

            {/* Desktop nav links ONLY */}
            <div className="hidden md:flex items-center gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(item.href)
                      ? 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
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
                className="p-2 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Toggle theme"
                aria-label="Toggle theme"
              >
                {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </button>

              <button
                onClick={handleLogout}
                className="p-2 rounded-md text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Logout"
              >
                <LogOut className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* MOBILE BOTTOM TAB BAR */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t border-gray-200 dark:border-gray-800">
        <div className="pb-[env(safe-area-inset-bottom)]">
          <div className="flex justify-around">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex flex-col items-center py-3 px-2 text-xs font-medium flex-1 ${
                    active
                      ? 'text-gray-900 dark:text-white border-t-2 border-gray-900 dark:border-white'
                      : 'text-gray-500 dark:text-gray-400'
                  }`}
                >
                  <Icon className="w-5 h-5 mb-1" />
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
