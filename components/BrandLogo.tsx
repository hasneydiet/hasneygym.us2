'use client';

import Link from 'next/link';

type BrandLogoProps = {
  href?: string;
  className?: string;
  /**
   * Icon size in px
   */
  iconSize?: number;
  /**
   * Show tagline under brand text
   */
  showTagline?: boolean;
  /**
   * Tagline visibility on small screens. If false, tagline is hidden on <md.
   */
  taglineOnMobile?: boolean;
  /**
   * Center align text (useful for login page)
   */
  centered?: boolean;
};

function SpartanHelmetIcon({ size = 28 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M32 6C20.4 6 11 15.4 11 27v7c0 10.4 7.6 19.1 17.6 20.7 1.5.2 2.9-.9 2.9-2.4V42.8c0-1.1-.9-2-2-2h-7.7c-1.7 0-3-1.3-3-3V27c0-6.1 5-11 11.2-11 6.1 0 11.1 4.9 11.1 11v10.8c0 1.7-1.3 3-3 3H33.5c-1.1 0-2 .9-2 2V52c0 1.5 1.4 2.6 2.9 2.4C45.4 53.1 53 44.4 53 34v-7C53 15.4 43.6 6 32 6Z"
        fill="currentColor"
        opacity="0.95"
      />
      <path
        d="M22 30.5h20.2c1.1 0 2-.9 2-2 0-1.1-.9-2-2-2H22c-1.1 0-2 .9-2 2 0 1.1.9 2 2 2Z"
        fill="currentColor"
        opacity="0.75"
      />
      <path
        d="M27.5 30.5v14.8c0 1 .8 1.8 1.8 1.8 1 0 1.8-.8 1.8-1.8V30.5h-3.6Z"
        fill="currentColor"
        opacity="0.75"
      />
    </svg>
  );
}

export default function BrandLogo({
  href,
  className = '',
  iconSize = 28,
  showTagline = true,
  taglineOnMobile = true,
  centered = false,
}: BrandLogoProps) {
  const content = (
    <div className={`flex items-center gap-3 ${centered ? 'justify-center' : ''} ${className}`}>
      <div className="text-gray-900 dark:text-white">
        <SpartanHelmetIcon size={iconSize} />
      </div>

      <div className={`leading-tight ${centered ? 'text-center' : ''}`}>
        <div className="text-sm md:text-lg font-bold text-white">
          <span className="text-white">Spartan</span>
          <span className="text-green-500 font-extrabold">X</span>
        </div>

        {showTagline && (
          <div
            className={`text-xs text-gray-500 dark:text-gray-400 ${
              taglineOnMobile ? '' : 'hidden md:block'
            }`}
          >
            Hasney Personal Workout Tracker
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
