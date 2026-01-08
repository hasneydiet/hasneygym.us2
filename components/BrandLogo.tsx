'use client';

import Link from 'next/link';
import Image from 'next/image';

type BrandLogoProps = {
  href?: string;
  className?: string;
  showTagline?: boolean;
  taglineOnMobile?: boolean;
  centered?: boolean;

  /**
   * Kept for backward compatibility.
   */
  iconSize?: number;
};

export default function BrandLogo({
  href,
  className = '',
  showTagline = true,
  taglineOnMobile = true,
  centered = false,
}: BrandLogoProps) {
  const content = (
    <div className={`flex items-center ${centered ? 'justify-center' : ''} ${className}`}>
      <div className={`leading-tight ${centered ? 'text-center' : ''}`}>
        <div className={`flex items-center ${centered ? 'justify-center' : ''}`}>
          {/*
            Wide wordmark logo:
            - Height-based sizing prevents overflow on iPhone + Galaxy Ultra
            - Max width keeps it inside header without changing layout
          */}
          <Image
            src="/logo.png"
            alt="Dtracker"
            width={2048}
            height={674}
            priority
            className="h-8 w-auto max-w-[170px] md:h-9 md:max-w-[240px]"
          />
          <span className="sr-only">Dtracker</span>
        </div>

        {showTagline && (
          <div
            className={`text-xs text-gray-500 dark:text-gray-400 ${
              taglineOnMobile ? '' : 'hidden md:block'
            }`}
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
