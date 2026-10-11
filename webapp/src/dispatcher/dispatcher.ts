// Dispatcher: the single command entry point (plan section 1 principle 3).
// Buttons and gestures only dispatch commands; today the sources are UI events,
// tomorrow ASR / bluetooth clickers are just one more source calling dispatch().
// The dispatcher owns the side-effect mapping: state transitions (runner),
// announcements (speaker), feedback (vibration), and persistence (store).

import type { Command, RunnerEvent, RunnerState } from '../runner/runner';

export interface DispatcherHooks {
  /** Apply a command through the pure runner; returns new state + events. */
  apply(cmd: Command, now: number): { state: RunnerState; events: RunnerEvent[] };
  setState(state: RunnerState): void;
  /** Announce the unit the pointer moved onto. */
  announce(state: RunnerState, event: Extract<RunnerEvent, { type: 'unit' }>): void;
  /** Finish announcement + transition (summary data inside the event). */
  finish(event: Extract<RunnerEvent, { type: 'finished' }>): void;
  vibrate(pattern: number | number[]): void;
  persist(state: RunnerState): void;
  /** Observer for every raw event (M3: completed/skipped feed batch-mode
   * blips/milestones in the UI layer -- no new command semantics). */
  onEvent?(ev: RunnerEvent): void;
}

export function dispatch(hooks: DispatcherHooks, cmd: Command, now: number = Date.now()): void {
  const { state, events } = hooks.apply(cmd, now);

  for (const ev of events) {
    hooks.onEvent?.(ev);
    switch (ev.type) {
      case 'unit':
        hooks.announce(state, ev);
        break;
      case 'invalid':
        hooks.vibrate(120); // short buzz: press had no effect
        break;
      case 'undo-confirmed':
        hooks.vibrate([30, 60, 30]);
        break;
      case 'finished':
        hooks.finish(ev);
        break;
      default:
        break; // completed / skipped: visual+vibration handled by the button itself
    }
  }

  hooks.setState(state);
  // atomic persist after every operation (plan section 9: resumable breakpoints)
  hooks.persist(state);
}
