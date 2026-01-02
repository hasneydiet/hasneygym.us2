'use client';

import Link from 'next/link';

type BrandLogoProps = {
  href?: string;
  className?: string;
  showTagline?: boolean;
  taglineOnMobile?: boolean;
  centered?: boolean;
};

export default function BrandLogo({
  href,
  className = '',
  showTagline = true,
  taglineOnMobile = true,
  centered = false,
}: BrandLogoProps) {
  const content = (
    <div
      className={`flex items-center ${centered ? 'justify-center' : ''} ${className}`}
    >
      <div className={`leading-tight ${centered ? 'text-center' : ''}`}>
        <div className="text-lg md:text-xl font-bold">
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
