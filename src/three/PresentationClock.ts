import type { Snapshot } from '../../shared/types';

type ClockSample = Pick<Snapshot, 'id' | 'clock' | 'status'>;

/** Interpolate authoritative snapshots; never advance the simulation or predict past them. */
export class PresentationClock {
  private id?: string;
  private from = 0;
  private to = 0;
  private receivedAt = 0;
  private duration = 500;
  private running = false;

  sample(world: ClockSample, now: number): number {
    const running = world.status === 'running_live';
    const elapsed = Math.max(0, now - this.receivedAt);
    const current = this.from + (this.to - this.from) * Math.min(1, elapsed / this.duration);
    // Pausing, restoring a save, and returning from a suspended tab use the exact world time.
    if (this.id !== world.id || !running || !this.running || world.clock < this.to ||
        world.clock - this.to > 120 || (world.clock !== this.to && elapsed > 2000)) {
      this.from = this.to = world.clock;
      this.receivedAt = now;
    } else if (world.clock !== this.to) {
      this.from = current;
      this.to = world.clock;
      this.duration = Math.max(100, Math.min(750, elapsed));
      this.receivedAt = now;
    }
    this.id = world.id;
    this.running = running;
    return this.from + (this.to - this.from) * Math.min(1, Math.max(0, now - this.receivedAt) / this.duration);
  }
}
