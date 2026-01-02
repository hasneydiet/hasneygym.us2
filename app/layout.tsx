import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/lib/theme';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'SpartanX - Hasney Personal Workout Tracker',
  description: 'Hasney Personal Workout Tracker',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100 antialiased overflow-x-hidden`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
