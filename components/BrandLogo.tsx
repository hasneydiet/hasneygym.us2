'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTheme } from '@/lib/theme';

type BrandLogoProps = {
  href?: string;
  className?: string;
  showTagline?: boolean;
  taglineOnMobile?: boolean;
  centered?: boolean;

  /**
   * Kept for backward compatibility.
   * When using the mobile mark on small screens, this is treated as the square size.
   */
  iconSize?: number;
};

export default function BrandLogo({
  href,
  className = '',
  showTagline = false,
  taglineOnMobile = true,
  centered = false,
  iconSize = 28,
}: BrandLogoProps) {
  const { theme } = useTheme();

  const isDark = theme === 'dark';

  // Image asset selection
  const desktopSrc = isDark ? '/brand/logo-desktop-dark.png' : '/brand/logo-desktop.png';
  const mobileSrc = isDark ? '/brand/logo-mobile-dark.png' : '/brand/logo-mobile.png';
  const loginSrc = isDark ? '/brand/logo-login-dark.png' : '/brand/logo-login.png';

  const content = (
    <div className={`flex items-center ${centered ? 'justify-center' : ''} ${className}`}>
      <div className={`leading-tight ${centered ? 'text-center' : ''}`}>
        {/* Header / general brand lockups */}
        {!centered ? (
          <div className={`flex items-center ${centered ? 'justify-center' : ''}`}>
            {/* Mobile mark */}
            <div className="md:hidden">
              <Image
                src={mobileSrc}
                alt="H-Core"
                width={iconSize}
                height={iconSize}
                priority
              />
            </div>

            {/* Desktop wordmark */}
            <div className="hidden md:block">
              <Image
                src={desktopSrc}
                alt="H-Core"
                width={160}
                height={52}
                priority
              />
            </div>
          </div>
        ) : (
          /* Login / centered lockup */
          <div className="flex justify-center">
            <Image
              src={loginSrc}
              alt="H-Core"
              width={260}
              height={86}
              priority
            />
          </div>
        )}

        {showTagline && (
          <div
            className={`mt-1 text-xs text-secondary-foreground ${
              taglineOnMobile ? '' : 'hidden md:block'
            } ${centered ? 'text-center' : ''}`}
          >
            Personal Workout Tracker
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="inline-flex">
        {content}
      </Link>
    );
  }

  return content;
}
