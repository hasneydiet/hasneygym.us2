import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/lib/theme';
import PWARegister from '@/components/pwa/PWARegister';
import IOSViewportFix from '@/components/ios/IOSViewportFix';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'H-Core - Personal Workout Tracker',
  description: 'Personal Workout Tracker',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=5, viewport-fit=cover',
  manifest: '/manifest.json',
  // PWA polish: ensure correct status bar + theme behavior in standalone mode.
  // Keep colors consistent with the existing dark theme.
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0F0F14' },
    { media: '(prefers-color-scheme: light)', color: '#0F0F14' },
  ],
  icons: {
    icon: [
      { url: '/icons/icon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-180x180.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'H-Core',
  },
  other: {
    // iOS + Android standalone polish
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
    // Avoid iOS auto-linking phone numbers
    'format-detection': 'telephone=no',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.className} min-h-screen antialiased overflow-x-hidden selection:bg-primary/20 selection:text-foreground`}
      >
        <ThemeProvider>
          <IOSViewportFix />
          <PWARegister />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}