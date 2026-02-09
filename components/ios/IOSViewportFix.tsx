'use client';

import { useEffect, useRef } from 'react';

/**
 * iOS Safari / iOS standalone PWA can return from background with a subtly incorrect
 * viewport scale after focusing inputs (keyboard/visualViewport changes).
 *
 * This component performs a minimal, iOS-only meta viewport "nudge" on key lifecycle
 * events to restore correct scale. No UI is rendered.
 */
function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const iOSUA = /iPad|iPhone|iPod/.test(ua);

  // iPadOS 13+ reports as Mac; detect via touch points.
  const iPadOS = navigator.platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1;

  return iOSUA || iPadOS;
}

function getViewportMeta(): HTMLMetaElement | null {
  return document.querySelector('meta[name="viewport"]');
}

function ensureMaxScale(content: string, maxScale: string): string {
  const hasMax = /maximum-scale\s*=\s*[\d.]+/i.test(content);
  if (hasMax) {
    return content.replace(/maximum-scale\s*=\s*[\d.]+/i, `maximum-scale=${maxScale}`);
  }
  // Keep formatting consistent with existing content.
  return content.trim().length ? `${content}, maximum-scale=${maxScale}` : `maximum-scale=${maxScale}`;
}

export default function IOSViewportFix() {
  const hadInputFocusRef = useRef(false);
  const inFlightRef = useRef(false);
  const lastRunAtRef = useRef(0);

  useEffect(() => {
    if (!isIOSDevice()) return;

    const scheduleFix = () => {
      if (!hadInputFocusRef.current) return;

      // Debounce / avoid excessive churn
      const now = Date.now();
      if (now - lastRunAtRef.current < 200) return;

      // If visualViewport exists and scale looks fine, skip.
      // (Still keep the ability to fix when scale is wrong.)
      const vv = window.visualViewport;
      if (vv && Math.abs((vv as any).scale - 1) < 0.01) {
        // Some iOS states still appear "off" even when scale is 1,
        // but most cases track scale. We'll still run on pageshow/visible.
      }

      const meta = getViewportMeta();
      if (!meta) return;

      const original = meta.getAttribute('content') || '';
      if (!original) return;

      if (inFlightRef.current) return;
      inFlightRef.current = true;
      lastRunAtRef.current = now;

      // Nudge: temporarily lock max scale to 1, then restore original.
      const locked = ensureMaxScale(original, '1');
      meta.setAttribute('content', locked);

      // Restore on next frame + small timeout to survive iOS timing quirks.
      requestAnimationFrame(() => {
        meta.setAttribute('content', original);
        window.setTimeout(() => {
          meta.setAttribute('content', original);
          inFlightRef.current = false;
        }, 50);
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Returning from background is the most common trigger.
        scheduleFix();
      }
    };

    const onPageShow = () => {
      // BFCache / app switching can trigger pageshow.
      scheduleFix();
    };

    const onFocusIn = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;

      const tag = (t.tagName || '').toLowerCase();
      const isFormControl = tag === 'input' || tag === 'textarea' || tag === 'select';
      const isEditable = (t as any).isContentEditable === true;

      if (isFormControl || isEditable) {
        hadInputFocusRef.current = true;
      }
    };

    const vv = window.visualViewport;
    const onVVResize = () => {
      // Keyboard open/close can shift visual viewport; after app switch it can stick.
      scheduleFix();
    };

    document.addEventListener('visibilitychange', onVisibilityChange, { passive: true });
    window.addEventListener('pageshow', onPageShow, { passive: true });
    document.addEventListener('focusin', onFocusIn, { passive: true });

    if (vv) {
      vv.addEventListener('resize', onVVResize, { passive: true });
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange as any);
      window.removeEventListener('pageshow', onPageShow as any);
      document.removeEventListener('focusin', onFocusIn as any);
      if (vv) {
        vv.removeEventListener('resize', onVVResize as any);
      }
    };
  }, []);

  return null;
}
