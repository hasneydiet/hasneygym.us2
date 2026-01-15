/**
 * Routine Day sorting helpers.
 *
 * Goal: Ensure Workout tab routine-day cards render in a human-friendly order:
 * - Day 1, Day 2, ... (numeric)
 * - Weekdays (Monday..Sunday)
 * - Letters (A, B, C, ...)
 * - DB fallback day_index
 *
 * Important: Sorting must NOT depend on routine names (renaming a routine
 * should not affect which day/week slot a routine-day belongs to).
 */

const WEEKDAY_ORDER: Record<string, number> = {
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
  sunday: 7, sun: 7,
};

export function parseDayLabelNumber(label: unknown): number | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  // Accept: "Day 1", "day1", "DAY 01", "Day 1 - Upper"
  const match = trimmed.match(/\bday\s*0*(\d+)\b/i);
  if (!match) return null;

  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function parseWeekLabelNumber(label: unknown): number | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  // Accept: "Week 1", "week1", "Week 02 - Day 3"
  const match = trimmed.match(/\bweek\s*0*(\d+)\b/i);
  if (!match) return null;

  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function parseWeekday(label: unknown): number | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim().toLowerCase();

  // Look for full/abbrev weekday tokens anywhere in the label.
  // Examples: "Monday", "Mon - Upper", "Week 2 - Tue"
  const tokenMatch = trimmed.match(/\b(monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)\b/);
  if (!tokenMatch) return null;

  return WEEKDAY_ORDER[tokenMatch[1]] ?? null;
}

export function parseAlphaLabel(label: unknown): number | null {
  if (typeof label !== 'string') return null;
  const trimmed = label.trim();
  // Accept: "A", "B - Upper", "C: Legs"
  const match = trimmed.match(/^\s*([A-Za-z])\b/);
  if (!match) return null;

  const code = match[1].toUpperCase().charCodeAt(0);
  if (code < 65 || code > 90) return null;
  return code - 64; // A=1..Z=26
}

/**
 * Returns a numeric sort key where lower values come first.
 *
 * Strategy:
 * - If label contains "Week N", use that as a primary bucket (Week 1 before Week 2).
 * - Within a week (or when week is absent), prefer:
 *   1) Day N numbers
 *   2) Weekdays (Mon..Sun)
 *   3) Letters (A..Z)
 *   4) DB day_index (as a last resort)
 * - Unknown labels sort last.
 */
export function getRoutineDaySortKey(day: { name?: unknown; day_index?: unknown }): number {
  const name = (day as any)?.name;

  const week = parseWeekLabelNumber(name) ?? 0;

  const dayNum = parseDayLabelNumber(name);
  if (dayNum !== null) return week * 1000 + 1 * 100 + dayNum;

  const weekday = parseWeekday(name);
  if (weekday !== null) return week * 1000 + 2 * 100 + weekday;

  const alpha = parseAlphaLabel(name);
  if (alpha !== null) return week * 1000 + 3 * 100 + alpha;

  // day_index in DB is an int. In this project it is treated as 0-based in
  // places, so convert to 1-based when used as a fallback ordering.
  const idx = Number((day as any)?.day_index);
  if (Number.isFinite(idx)) return week * 1000 + 4 * 100 + (Math.floor(idx) + 1);

  return Number.MAX_SAFE_INTEGER;
}

export function sortRoutineDays<
  T extends { id?: string; routine_id?: string; name?: unknown; day_index?: unknown }
>(days: T[]): T[] {
  return [...days].sort((a, b) => {
    const ka = getRoutineDaySortKey(a);
    const kb = getRoutineDaySortKey(b);
    if (ka !== kb) return ka - kb;

    // Stable tie-breakers (avoid dependence on routine name).
    const ra = String((a as any).routine_id ?? '');
    const rb = String((b as any).routine_id ?? '');
    if (ra !== rb) return ra.localeCompare(rb);

    return String((a as any).id ?? '').localeCompare(String((b as any).id ?? ''));
  });
}
