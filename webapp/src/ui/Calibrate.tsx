// Calibration screen (plan section 7, M3): show the board outline with its
// landmarks; the user rotates the map (buttons) or turns the phone until the
// on-screen orientation matches the physical board on the table, then locks.
// The angle persists per task; until locked, direction words stay silent
// (宁可少说，不说错的). The face-turn confirm/re-calibration FLOW is M4.

import { useState } from 'react';
import type { StjTask } from '../loader/types';
import { BoardMap } from '../boardmap/BoardMap';
import { vibrate } from '../util/hardware';

export function CalibrateScreen(props: {
  task: StjTask;
  initialDeg: number;
  onLock(deg: number): void;
  onSkip(): void;
  /** soak F-UX1: way back out of calibration (to the menu or the loop,
   * depending on where this screen was entered from). */
  onBack?(): void;
}) {
  const [deg, setDeg] = useState(props.initialDeg);

  return (
    <div class="screen cal-screen">
      <div class="topbar">
        <h1>朝向标定</h1>
        {props.onBack && (
          <button class="btn btn-small" data-testid="cal-back" onClick={props.onBack}>
            ← 返回
          </button>
        )}
        <button class="btn btn-small" data-testid="cal-skip" onClick={props.onSkip}>
          暂不标定
        </button>
      </div>
      <div class="cal-hint muted">
        把手机转一转（或点下面的角度），让屏幕里板子的方向和桌面上的一致
      </div>

      <div class="cal-map">
        <BoardMap
          task={props.task}
          statuses={{}}
          currentPid={null}
          viewSide="top"
          calibDeg={deg}
          flip="none"
          mode="mini"
        />
      </div>

      <div class="cal-landmarks">
        {props.task.meta.landmarks.length > 0 ? (
          props.task.meta.landmarks.map((lm) => (
            <span class="badge" key={lm.ref}>
              {lm.ref} {lm.speak}
            </span>
          ))
        ) : (
          <span class="muted">此任务没有地标，按板框对齐即可</span>
        )}
      </div>

      <div class="cal-rot" data-testid="cal-rot">
        {[0, 90, 180, 270].map((d) => (
          <button
            key={d}
            class={`btn cal-rot-btn ${d === norm(deg) ? 'btn-primary' : ''}`}
            data-testid={`rot-${d}`}
            onClick={() => {
              vibrate(20);
              setDeg(d);
            }}
          >
            {d}°
          </button>
        ))}
      </div>

      <button
        class="btn btn-primary cal-lock"
        data-testid="cal-lock"
        onClick={() => {
          vibrate([30, 40, 30]);
          props.onLock(norm(deg));
        }}
      >
        ✓ 就这么摆（{norm(deg)}°）
      </button>
    </div>
  );
}

function norm(d: number): number {
  return ((d % 360) + 360) % 360;
}
