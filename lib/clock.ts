/**
 * Injectable time. Nothing under /lib may read the wall clock directly: the
 * judged path must replay identically every run (AGENTS.md section 9), and a
 * test enforces that `Date.now`, `new Date()` and `Math.random` never appear
 * in /lib outside this file.
 */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
  iso(): string;
}

/** Deterministic clock driven by fixtures: it only moves when told to. */
export class FixtureClock implements Clock {
  private t: number;

  constructor(startIso: string) {
    const parsed = Date.parse(startIso);
    if (Number.isNaN(parsed)) throw new Error(`FixtureClock: invalid start time "${startIso}"`);
    this.t = parsed;
  }

  now(): number {
    return this.t;
  }

  iso(): string {
    return new Date(this.t).toISOString();
  }

  advance(ms: number): void {
    if (ms < 0) throw new Error("FixtureClock: time only moves forward");
    this.t += ms;
  }
}

/** Wall clock, for the optional live side demo only. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }

  iso(): string {
    return new Date().toISOString();
  }
}
