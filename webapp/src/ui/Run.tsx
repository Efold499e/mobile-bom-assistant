// Run screen: the product's heart (plan sections 2 + 5 + 8 + 9).
// Fixed layout: big card area on top (card left 2/3 + map thumbnail right 1/3),
// exactly three buttons below (上一个 1fr / 重新播报 1fr / 完成 2fr).
// Flow orchestration (all UI-layer; the runner/dispatcher never grew new
// commands): 报菜名 menu -> calibration -> loop -> (face flip on side change)
// -> finishing list for skipped units -> makeup pass reusing the same loop ->
// summary. Batch mode asks once per group; blip per piece.

import { useEffect, useMemo, useRef, useState } from 'react';
import { getSpeaker, type FinishSummary, type SideStat } from '../app';
import { dispatch, type DispatcherHooks } from '../dispatcher/dispatcher';
import { planQueue, effectiveGidOrder, type QueueUnit } from '../planner/snake';
import { BatchTracker, batchCountOf, remainingPendingInGroup } from '../runner/batch';
import { finishListPids, makeupRunner, mergeMakeup } from '../runner/makeup';
import type { RunnerState } from '../runner/runner';
import { applyCommand, initialRunner, nextPendingIndex } from '../runner/runner';
import {
  askBatchSentence,
  batchMilestoneSentence,
  faceDoneSentence,
  finishListSentence,
  finishSentence,
  groupIntroSentence,
  locationCardText,
  locationPhrase,
  sideWord,
  unitSentence,
} from '../speaker/sentence';
import {
  getSettings,
  getTask,
  persistCalib,
  persistPickOrder,
  persistRun,
} from '../store/db';
import type { StjTask } from '../loader';
import type { Side } from '../loader/types';
import { BoardMap } from '../boardmap/BoardMap';
import { effectiveDeg, type Flip } from '../boardmap/geo';
import { CalibrateScreen } from './Calibrate';
import { MenuScreen } from './Menu';
import { WakeLockHolder, lockPortrait, screenAngleDeg, vibrate } from '../util/hardware';

const LONG_PRESS_MS = 600;

function summarize(s: RunnerState, task: StjTask): FinishSummary {
  let done = 0;
  let skipped = 0;
  for (const pid of s.order) {
    if (s.statuses[pid] === 'done') done += 1;
    else if (s.statuses[pid] === 'skipped') skipped += 1;
  }
  const sides: SideStat[] = task.sides.map((side) => {
    const pids = task.placements.filter((p) => p.side === side).map((p) => p.pid);
    return {
      side,
      total: pids.length,
      done: pids.filter((pid) => s.statuses[pid] === 'done').length,
    };
  });
  return {
    total: s.order.length,
    done,
    skipped,
    elapsedMs: Math.max(0, (s.finishedAt ?? Date.now()) - (s.startedAt ?? s.finishedAt ?? Date.now())),
    sides,
  };
}

export function RunScreen(props: {
  taskId: string;
  onFinish(finish: FinishSummary): void;
  onExit(): void;
}) {
  const [task, setTask] = useState<StjTask | null>(null);
  const [, setTick] = useState(0); // re-render after each dispatch
  const [phase, setPhase] = useState<'loading' | 'menu' | 'calibrate' | 'loop' | 'finishList'>('loading');
  const [calibDeg, setCalibDeg] = useState<number | null>(null);
  const [calibFlip, setCalibFlip] = useState<'lr' | 'tb'>('lr');
  const [fullMap, setFullMap] = useState(false);
  const [followKey, setFollowKey] = useState(0);
  const [batchAsk, setBatchAsk] = useState<{ gid: string } | null>(null);
  const [batchGids, setBatchGids] = useState<Set<string>>(new Set());
  const [flipAsk, setFlipAsk] = useState<{ from: Side } | null>(null);
  const [menuPicks, setMenuPicks] = useState<string[] | undefined>(undefined);

  const queue = useRef<QueueUnit[]>([]);
  const runnerRef = useRef<RunnerState | null>(null);
  const mainRef = useRef<RunnerState | null>(null); // main run (makeup runs beside it)
  const makeupRef = useRef<RunnerState | null>(null);
  const wakeLock = useRef(new WakeLockHolder());
  const taskRef = useRef<StjTask | null>(null);
  const startedRef = useRef(false);
  const batchRef = useRef(new BatchTracker());
  const pendingAskRef = useRef<string | null>(null);
  const sideRef = useRef<Side>('top'); // face currently on the bench
  const lastSpokenGid = useRef<string | null>(null); // concise-announce tracking
  const conciseRef = useRef(true);
  // view info as refs so the memoized dispatcher hooks never read stale state
  const viewInfoRef = useRef<{ deg: number | null; flip: 'lr' | 'tb' }>({ deg: null, flip: 'lr' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rec = await getTask(props.taskId);
      if (!rec || cancelled) return;
      const t = rec.task;
      taskRef.current = t;
      setTask(t);
      const planned = planQueue(t, rec.pickOrder);
      queue.current = planned;
      const order = planned.map((u) => u.pid);
      runnerRef.current = rec.run
        ? { ...initialRunner(order), ...rec.run, order }
        : initialRunner(order);
      // resume on real work: if the stored pointer parks on a skipped/done
      // unit (e.g. right after a swipe-skip + refresh), advance to first pending
      if (rec.run) {
        const s = runnerRef.current;
        if (s.pointer >= 0 && s.statuses[s.order[s.pointer]] !== 'pending') {
          const next = nextPendingIndex(s, s.pointer);
          if (next !== -1) s.pointer = next;
        }
      }
      sideRef.current =
        runnerRef.current.pointer >= 0
          ? queue.current[runnerRef.current.pointer].side
          : 'top';
      // resume straight into the summary if this task was already finished
      if (rec.run?.finishedAt) {
        props.onFinish(summarize(runnerRef.current, t));
        return;
      }
      // settings into the live speaker / batch tracker
      const st = await getSettings();
      if (cancelled) return;
      getSpeaker().setRate(st.rate);
      getSpeaker().setVoice(st.voiceName ?? null);
      batchRef.current.setThreshold(st.batchThreshold);
      conciseRef.current = st.conciseTts !== false;
      setMenuPicks(rec.pickOrder);
      if (rec.calib) {
        // load the saved calibration into state in EVERY entry path (menu,
        // calibrate, loop) so the menu path can enter the loop directly
        viewInfoRef.current = { deg: effectiveDeg(rec.calib.deg, screenAngleDeg()), flip: rec.calib.flip };
        setCalibDeg(rec.calib.deg);
        setCalibFlip(rec.calib.flip);
      }
      if (!rec.run && !rec.pickOrder) {
        setPhase('menu'); // fresh start: 报菜名 first
      } else if (rec.calib) {
        setPhase('loop');
        startLoop();
      } else {
        setPhase('calibrate');
      }
      setTick((x) => x + 1);
    })();
    const onOri = () => setTick((x) => x + 1); // iOS rotation compensation re-render
    window.addEventListener('orientationchange', onOri);
    return () => {
      cancelled = true;
      window.removeEventListener('orientationchange', onOri);
      wakeLock.current.release();
      document.removeEventListener('visibilitychange', wakeLock.current.onVisibilityChange);
      getSpeaker().dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.taskId]);

  const startLoop = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    const wl = wakeLock.current;
    void wl.acquire();
    void lockPortrait(); // Android; iOS falls back to angle compensation
    document.addEventListener('visibilitychange', wl.onVisibilityChange);
    dispatch(hooksRef.current, 'start', Date.now());
  };

  const groupOf = (gid: string) => taskRef.current?.groups.find((g) => g.gid === gid);

  // view-frame flip for a unit: only the bottom face is mirrored
  const flipFor = (side: Side, flip: 'lr' | 'tb'): Flip => (side === 'bottom' ? flip : 'none');

  const speakUnit = (s: RunnerState, pid: number) => {
    const t = taskRef.current;
    if (!t) return;
    const idx = s.order.indexOf(pid);
    const unit = queue.current[idx];
    const group = unit && groupOf(unit.gid);
    if (!group) return;
    const p = t.placements.find((pl) => pl.pid === pid);
    // AI-baked hint (conversion-time DeepSeek) wins; rule-based nine-grid is
    // the offline fallback -- both are already user-frame worded
    const loc =
      p?.loc_speak ??
      (p && viewInfoRef.current.deg !== null
        ? (locationPhrase(
            p.x_mm,
            p.y_mm,
            t,
            flipFor(unit.side, viewInfoRef.current.flip),
            viewInfoRef.current.deg,
          ) ?? undefined)
        : undefined);
    // 简洁播报: pieces 2+ of the SAME group skip the fp/value repetition
    const concise = conciseRef.current && unit.gid === lastSpokenGid.current;
    lastSpokenGid.current = unit.gid;
    getSpeaker().say(unitSentence({ index: idx + 1, total: s.order.length, group, loc, concise }));
  };

  const hooks = useMemo<DispatcherHooks>(
    () => ({
      apply: (cmd, now) => {
        const cur = runnerRef.current ?? initialRunner([]);
        return applyCommand(cur, cmd, now);
      },
      setState: (s) => {
        runnerRef.current = s;
        if (!makeupRef.current) mainRef.current = s;
        setTick((x) => x + 1);
      },
      announce: (s, ev) => {
        const t = taskRef.current;
        if (!t) return;
        const idx = s.order.indexOf(ev.pid);
        const unit = queue.current[idx];
        const group = unit && groupOf(unit.gid);
        if (!group) return;
        // face flip: the first unit of the next face opens the confirm dialog
        // (plan section 9: 双面衔接; reuses calibration, no new command)
        if (unit.side !== sideRef.current) {
          const from = sideRef.current;
          sideRef.current = unit.side;
          setFlipAsk({ from });
          getSpeaker().say(faceDoneSentence(from));
          return;
        }
        // batch mode is UI-layer flow on top of the unchanged runner: an
        // undecided eligible group pops the ask (silently), an active batch
        // group stays silent (blips come per completion)
        const tracker = batchRef.current;
        if (tracker.shouldAsk(group)) {
          pendingAskRef.current = unit.gid;
          setBatchAsk({ gid: unit.gid });
          return;
        }
        if (tracker.isBatch(unit.gid)) return;
        speakUnit(s, ev.pid);
      },
      finish: (ev) => {
        const t = taskRef.current;
        if (!t) return;
        if (makeupRef.current) {
          // makeup queue drained: merge and head to the summary (plan §9 全清)
          const merged = mergeMakeup(mainRef.current!, makeupRef.current);
          makeupRef.current = null;
          mainRef.current = merged;
          runnerRef.current = merged;
          void persistRun(props.taskId, merged);
          getSpeaker().say(finishSentence(t, merged.finishedAt! - merged.startedAt!));
          setTimeout(() => props.onFinish(summarize(merged, t)), 400);
        } else if (ev.skipped > 0) {
          getSpeaker().say(finishListSentence());
          setPhase('finishList');
        } else {
          getSpeaker().say(finishSentence(t, ev.elapsedMs));
          setTimeout(() => props.onFinish(summarize(runnerRef.current!, t)), 400);
        }
      },
      vibrate: (pattern) => vibrate(pattern),
      persist: (s) => {
        if (!makeupRef.current) void persistRun(props.taskId, s);
      },
      onEvent: (ev) => {
        // batch feedback per completed/skipped piece + 剩3/剩1 milestones
        if (ev.type !== 'completed' && ev.type !== 'skipped') return;
        const s = runnerRef.current; // old state: setState runs after the loop
        if (!s) return;
        const unit = queue.current.find((u) => u.pid === ev.pid);
        if (!unit || !batchRef.current.isBatch(unit.gid)) return;
        getSpeaker().blip();
        vibrate(30);
        const rem = remainingPendingInGroup(queue.current, s.statuses, unit.gid) - 1;
        const milestone = batchMilestoneSentence(rem);
        if (milestone) getSpeaker().say(milestone);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.taskId],
  );
  const hooksRef = useRef(hooks);
  hooksRef.current = hooks;

  const doDispatch = (cmd: Parameters<typeof dispatch>[1]) => dispatch(hooks, cmd, Date.now());

  const decideBatch = (accept: boolean) => {
    const gid = pendingAskRef.current;
    if (!gid) return;
    const group = groupOf(gid);
    pendingAskRef.current = null;
    setBatchAsk(null);
    if (!group) return;
    batchRef.current.decide(group, accept ? 'batch' : 'single');
    vibrate(30);
    if (accept) {
      setBatchGids((prev) => new Set(prev).add(gid));
      getSpeaker().say(groupIntroSentence(group, group.qty));
    } else {
      const s = runnerRef.current;
      if (s && s.pointer >= 0) speakUnit(s, s.order[s.pointer]);
    }
  };

  // keep view-info refs in sync with render state
  const effCal = calibDeg === null ? null : effectiveDeg(calibDeg, screenAngleDeg());
  viewInfoRef.current = { deg: effCal, flip: calibFlip };

  const lockCal = (deg: number) => {
    setCalibDeg(deg);
    // update the view-info ref synchronously: the replay below dispatches
    // before the re-render, and the announcement must use the new angle
    viewInfoRef.current = { deg: effectiveDeg(deg, screenAngleDeg()), flip: calibFlip };
    void persistCalib(props.taskId, { deg, flip: calibFlip, at: Date.now() });
    setPhase('loop');
    if (!startedRef.current) startLoop();
    else doDispatch('replay'); // re-announce with the new orientation words
  };
  const skipCal = () => {
    setPhase('loop');
    if (!startedRef.current) startLoop();
  };

  const startWithOrder = (picks: string[]) => {
    const t = taskRef.current!;
    const order = effectiveGidOrder(t, picks);
    void persistPickOrder(props.taskId, order).then(() => {
      queue.current = planQueue(t, order);
      const s = initialRunner(queue.current.map((u) => u.pid));
      runnerRef.current = s;
      mainRef.current = s;
      sideRef.current = queue.current[0]?.side ?? 'top';
      if (calibDeg === null) setPhase('calibrate');
      else {
        viewInfoRef.current = { deg: effectiveDeg(calibDeg, screenAngleDeg()), flip: calibFlip };
        setPhase('loop');
        startLoop();
      }
    });
  };

  const confirmFlip = (flip: 'lr' | 'tb') => {
    setFlipAsk(null);
    setCalibFlip(flip);
    sideRef.current = queue.current[runnerRef.current?.pointer ?? 0]?.side ?? sideRef.current;
    void persistCalib(props.taskId, { deg: calibDeg ?? 0, flip, at: Date.now() });
    setPhase('calibrate'); // 翻面必须重标 (plan section 7)
  };

  const startMakeup = () => {
    const main = mainRef.current ?? runnerRef.current!;
    const leftovers = finishListPids(main.order, main.statuses);
    if (leftovers.length === 0) return;
    makeupRef.current = makeupRunner(leftovers);
    runnerRef.current = makeupRef.current;
    sideRef.current = queue.current[main.order.indexOf(leftovers[0])].side;
    setPhase('loop');
    dispatch(hooksRef.current, 'start', Date.now());
  };

  // ---- prev button: short press vs 600ms long press (undo) ----
  const holdTimer = useRef<number | null>(null);
  const armedLong = useRef(false);
  const [holdArmed, setHoldArmed] = useState(false);

  const onPrevDown = () => {
    armedLong.current = false;
    holdTimer.current = window.setTimeout(() => {
      armedLong.current = true;
      setHoldArmed(true);
      vibrate([40, 60, 40]); // double-pulse: undo armed
    }, LONG_PRESS_MS);
  };
  const onPrevUp = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHoldArmed(false);
    doDispatch(armedLong.current ? 'prev-long' : 'prev-short');
    armedLong.current = false;
  };
  const onPrevCancel = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
    setHoldArmed(false);
    armedLong.current = false;
  };

  // ---- card gestures: tap = replay, swipe up = skip (pointer events so the
  // same handlers serve touch on the phone and mouse in desktop automation) ----
  const touchStart = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
  const onCardPointerDown = (e: PointerEvent) => {
    touchStart.current = { x: e.clientX, y: e.clientY, t: Date.now(), id: e.pointerId };
  };
  const onCardPointerUp = (e: PointerEvent) => {
    const s = touchStart.current;
    touchStart.current = null;
    if (!s || s.id !== e.pointerId) return;
    const dy = e.clientY - s.y;
    const dx = e.clientX - s.x;
    if (dy < -50 && Math.abs(dx) < 80) {
      doDispatch('skip'); // swipe up: skip
    } else if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && Date.now() - s.t < 500) {
      doDispatch('replay'); // card tap: replay
    }
  };

  if (!task || !runnerRef.current || phase === 'loading') {
    return <div class="screen" />;
  }
  if (phase === 'menu') {
    return (
      <MenuScreen
        task={task}
        initialPicks={menuPicks}
        onStart={startWithOrder}
        onDefault={() => startWithOrder([])}
      />
    );
  }
  if (phase === 'calibrate') {
    return (
      <CalibrateScreen
        task={task}
        initialDeg={calibDeg ?? 0}
        onLock={lockCal}
        onSkip={skipCal}
      />
    );
  }
  if (phase === 'finishList') {
    const main = mainRef.current ?? runnerRef.current;
    const leftovers = finishListPids(main.order, main.statuses);
    const overrideStatuses: Record<number, 'pending' | 'done' | 'skipped'> = {};
    for (const pid of main.order) {
      overrideStatuses[pid] = leftovers.includes(pid) ? 'pending' : 'done';
    }
    const rows = leftovers.map((pid) => {
      const unit = queue.current[main.order.indexOf(pid)];
      const g = groupOf(unit.gid)!;
      return { pid, unit, g };
    });
    return (
      <div class="screen">
        <div class="topbar">
          <h1>收尾清单</h1>
          <span class="badge">{rows.length} 颗待补</span>
        </div>
        <div class="finish-body">
          <div class="finish-map">
            <BoardMap
              task={task}
              statuses={overrideStatuses}
              currentPid={null}
              viewSide="top"
              calibDeg={effCal ?? 0}
              flip="none"
              batchGids={new Set(rows.map((r) => r.unit.gid))}
              mode="full"
            />
          </div>
          <div class="stack">
            {rows.map((r) => (
              <div class="task-card finish-row" key={r.pid}>
                <div class="row1">
                  <span class="name">{r.unit.ref}</span>
                  <span class="badge">{sideWord(r.unit.side)}</span>
                  <span class="badge warn">第 {main.order.indexOf(r.pid) + 1} 颗</span>
                </div>
                <div class="muted">
                  {r.g.value} · {r.g.footprint_speak ?? r.g.footprint}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div class="controls">
          <button class="btn" data-testid="finish-exit" onClick={props.onExit}>
            先收工
          </button>
          <button class="btn btn-primary" data-testid="start-makeup" style={{ gridColumn: 'span 2' }} onClick={startMakeup}>
            开始补焊（{rows.length} 颗）
          </button>
        </div>
      </div>
    );
  }

  const state = runnerRef.current;
  const total = state.order.length;
  const unit = state.pointer >= 0 ? queue.current[state.pointer] : null;
  const group = unit ? groupOf(unit.gid) : undefined;
  const placement = unit ? task.placements.find((pl) => pl.pid === unit.pid) : undefined;
  const doneCount = state.order.filter((pid) => state.statuses[pid] === 'done').length;
  const viewSide: Side = unit?.side ?? 'top';
  const batchCount = unit && batchRef.current.isBatch(unit.gid)
    ? batchCountOf(queue.current, state.pointer)
    : null;
  const locCard =
    placement?.loc_speak ??
    (placement && effCal !== null && task
      ? locationCardText(placement.x_mm, placement.y_mm, task, flipFor(unit!.side, calibFlip), effCal)
      : null);
  const inMakeup = makeupRef.current !== null;

  const mapCommon = {
    task,
    statuses: state.statuses,
    currentPid: unit?.pid ?? null,
    viewSide,
    calibDeg: effCal ?? 0,
    flip: unit ? flipFor(unit.side, calibFlip) : ('none' as Flip),
    batchGids,
  };

  return (
    <div class="screen">
      <div class="run-meta">
        <span class="idx">
          {inMakeup ? '补焊 ' : ''}第 {Math.min(state.pointer + 1, total)}/{total} 颗
        </span>
        <span class="run-meta-right">
          {unit && <span class="badge">{sideWord(unit.side)}</span>}
          {unit?.side === 'bottom' && <span class="badge">镜像</span>}
          {group?.polarity && <span class="badge warn">⚠极性</span>}
          <button class="btn-link" data-testid="open-cal" onClick={() => setPhase('calibrate')}>
            标定
          </button>
        </span>
      </div>
      <div class="run-progress">
        <div class="fill" style={{ width: `${(100 * doneCount) / total}%` }} />
      </div>

      <div class="run-card-zone">
        <div
          class="run-card"
          data-testid="run-card"
          onPointerDown={onCardPointerDown}
          onPointerUp={onCardPointerUp}
          onPointerCancel={() => (touchStart.current = null)}
        >
          <div class="value">{group?.value ?? '—'}</div>
          <div class="fp">{group ? (group.footprint_speak ?? group.footprint) : ''}</div>
          <div class="loc" data-testid="card-loc">
            {locCard ?? (effCal === null ? '未标定方位' : '')}
          </div>
          {batchCount && (
            <div class="batch-n" data-testid="batch-count">
              本组 第 {batchCount.x}/{batchCount.n} 颗
            </div>
          )}
          <div class="hint">点卡片重听 · 上滑跳过</div>
        </div>
        <div class="map-thumb-wrap">
          <BoardMap {...mapCommon} mode="thumb" onTap={() => setFullMap(true)} />
        </div>
      </div>

      <div class="controls">
        <button
          class={`btn ${holdArmed ? 'pressed' : ''}`}
          data-testid="btn-prev"
          onPointerDown={onPrevDown}
          onPointerUp={onPrevUp}
          onPointerLeave={onPrevCancel}
          onPointerCancel={onPrevCancel}
        >
          {holdArmed ? '撤销待焊' : '上一个'}
        </button>
        <button
          class="btn"
          data-testid="btn-replay"
          onClick={() => {
            vibrate(30);
            doDispatch('replay');
          }}
        >
          重新播报
        </button>
        <button
          class="btn btn-primary"
          data-testid="btn-complete"
          onClick={(e) => {
            vibrate(30);
            (e.currentTarget as HTMLButtonElement).blur();
            doDispatch('complete');
          }}
        >
          完成
        </button>
      </div>

      {batchAsk && (
        <div class="modal" data-testid="batch-ask">
          <div class="modal-card">
            <div class="modal-title">
              {askBatchSentence(groupOf(batchAsk.gid)!, groupOf(batchAsk.gid)!.qty)}
            </div>
            <div class="modal-btns">
              <button class="btn" data-testid="batch-no" onClick={() => decideBatch(false)}>
                逐颗焊
              </button>
              <button class="btn btn-primary" data-testid="batch-yes" onClick={() => decideBatch(true)}>
                一起焊
              </button>
            </div>
          </div>
        </div>
      )}

      {flipAsk && (
        <div class="modal" data-testid="flip-ask">
          <div class="modal-card">
            <div class="modal-title">{sideWord(flipAsk.from)}焊完了</div>
            <div class="muted" style={{ textAlign: 'center' }}>
              翻面后地标位置会对调（
              {task.meta.landmarks.length > 0
                ? `如 ${task.meta.landmarks[0].ref} ${task.meta.landmarks[0].speak}`
                : '按板框对齐'}
              ），下一步重新标定。
            </div>
            <div class="modal-btns">
              <button class="btn" data-testid="flip-lr" onClick={() => confirmFlip('lr')}>
                左右翻
              </button>
              <button class="btn btn-primary" data-testid="flip-tb" onClick={() => confirmFlip('tb')}>
                上下翻
              </button>
            </div>
          </div>
        </div>
      )}

      {fullMap && (
        <div class="map-full">
          <div class="map-full-bar">
            <span>
              {sideWord(viewSide)}
              {viewSide === 'bottom' ? ' · 镜像视图' : ''}
            </span>
            <button
              class="chip"
              data-testid="map-follow"
              onClick={() => setFollowKey((k) => k + 1)}
            >
              回到当前
            </button>
            <button class="btn btn-small" data-testid="map-close" onClick={() => setFullMap(false)}>
              ✕ 关闭
            </button>
          </div>
          <div class="map-full-body">
            <BoardMap key={followKey} {...mapCommon} mode="full" />
          </div>
          <div class="map-full-hint muted">双指缩放 · 单指平移 · 双击回全景</div>
        </div>
      )}
    </div>
  );
}
