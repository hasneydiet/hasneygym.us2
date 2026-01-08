'use client';

import Link from 'next/link';

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
        <div className={`flex items-baseline gap-0.5 ${centered ? 'justify-center' : ''}`}>
          <span className="text-2xl md:text-[26px] font-extrabold tracking-tight leading-none">
            <span className="text-[#E53A9D]">D</span>
            <span className="text-black dark:text-white">tracker</span>
          </span>
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
