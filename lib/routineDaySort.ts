/**
 * Routine Day sorting helpers.
 *
 * Goal: Ensure Workout tab routine-day cards render in Day 1, Day 2, ... order.
 *
 * Important: Sorting must NOT depend on routine names (renaming a routine
 * should not affect which day/week slot a routine-day belongs to).
 */

export function parseDayLabelNumber(label: unknown): number | null {
  if (typeof label !== 'string') return null;

  const trimmed = label.trim();
  // Accept: "Day 1", "day1", "DAY 01", "Day 1 - Upper"
  const match = trimmed.match(/^day\s*0*(\d+)(?:\b|\s|$)/i);
  if (!match) return null;

  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

export function getRoutineDaySortKey(day: { name?: unknown; day_index?: unknown }): number {
  const parsed = parseDayLabelNumber((day as any)?.name);
  if (parsed !== null) return parsed;

  // day_index in DB is an int. In this project it is treated as 0-based in
  // places, so convert to 1-based when used as a "Day N" ordering fallback.
  const idx = Number((day as any)?.day_index);
  if (Number.isFinite(idx)) return Math.floor(idx) + 1;

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
