// Source time (the raw recording) vs. output time (after trimming and removing pauses).

export type Range = [number, number];

/** The parts of the recording that end up in the video. */
export function keepRanges(trim: Range, pauses: Range[]): Range[] {
  const cuts = [...pauses].sort((a, b) => a[0] - b[0]);
  const keeps: Range[] = [];
  let start = trim[0];
  for (const [a, b] of cuts) {
    if (b <= start) continue;
    if (a >= trim[1]) break;
    if (a > start) keeps.push([start, a]);
    start = Math.max(start, b);
  }
  if (trim[1] > start) keeps.push([start, trim[1]]);
  return keeps.filter(([a, b]) => b - a > 0.05);
}

export function outputDuration(keeps: Range[]): number {
  return keeps.reduce((sum, [a, b]) => sum + (b - a), 0);
}

/** Output time for a source time, or null if that moment is cut. */
export function toOutput(t: number, keeps: Range[]): number | null {
  let offset = 0;
  for (const [a, b] of keeps) {
    if (t < a) return null;
    if (t <= b) return offset + (t - a);
    offset += b - a;
  }
  return null;
}

/** Source time for an output time. */
export function toSource(o: number, keeps: Range[]): number {
  let offset = 0;
  for (const [a, b] of keeps) {
    if (o <= offset + (b - a)) return a + (o - offset);
    offset += b - a;
  }
  return keeps.length ? keeps[keeps.length - 1][1] : 0;
}

/** The keep range that follows a source time, used to skip cuts while previewing. */
export function nextKeepStart(t: number, keeps: Range[]): number | null {
  for (const [a, b] of keeps) {
    if (t < a) return a;
    if (t <= b) return null;
  }
  return null;
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
