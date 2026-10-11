# M3 验收报告 —— 点位图 + 朝向标定 + 批量模式

> 执行日期：2026-10-11。执行 prompt：`docs/prompts/m3.md`。环境：Windows 10 / node v24.18.0 / vite 8.3 / preact 10.29 / TypeScript 6.0。
> 结论先行：**验收 1–3、5 条（自动化部分）全部通过，第 4 条（真机）阻塞待机**（见 `docs/qa/m3/device.md`），第 6 条 tag `m3-done` 已打。
> 本阶段自动化过程中发现并修复 **3 个真 bug**（见 §5，均有回归验证）。

## 1. 单元测试（vitest）——56/56 全绿

```
$ npm run test
✓ src/boardmap/geo.test.ts        (14 tests)  九宫格断言矩阵(9格×4标定角/三分线边界)/镜像词变换/翻转×旋转顺序/旋转数学(toViewFrame角点/extent换面)/359→0环绕/最近地标
✓ src/runner/batch.test.ts        (8 tests)   阈值判定(4问/3不问)/每组一次询问/同组重决/批量计数x/N/组内剩余数
✓ src/speaker/sentence.test.ts    (14 tests)  M1 句模板保持 + 新增: loc插入/groupIntro/askBatch/里程碑(仅剩3、剩1)/方位词短语(未标定null/随角旋转/无地标省略)
✓ src/loader/loader.test.ts       (9 tests)   未动，保持绿
✓ src/dispatcher/dispatcher.test.ts (7 tests) 未动语义，保持绿（新增可选 onEvent 观察钩子，不改指令集）
✓ src/planner/snake.test.ts       (4 tests)   未动，保持绿
```

必测项对照（m3.md §1）：九宫格词矩阵（四角/中心/三分线边界 × 标定 0/90/180/270）✓；镜像下词变换（lr/tb + 镜像先于旋转）✓；最近地标选择（含平局取首个）✓；标定旋转数学（`toViewFrame` 角点映射 + `effectiveDeg` 359→0 环绕）✓；批量触发阈值判定 ✓。

## 2. 构建与回归

```
$ npm run build   → tsc -b && vite build ✓ (dist/assets/index-*.js, PWA precache 12 entries)
$ python -m unittest discover -s converter/tests → Ran 41 tests ... OK（证明未碰坏 converter）
```

边界遵守：`converter/`、`tools/`、`docs/stj-spec.md`、`demo.stj.json` 只读未动；dispatcher 未新增指令语义（仅加可选 `onEvent` 事件观察钩子，批量提示音走 UI 层）；store 仅增量字段（`calib`，另预声明 M4 的 `pickOrder`/`settings` 类型，无逻辑）；Canvas 无常驻 rAF（唯一 rAF 是 320ms 一次性跟随缓动，自终止；脉冲为 CSS 动画）。

## 3. 浏览器自动化（IAB，390×844 视口，dist preview 服务）

截图证据（`docs/qa/m3/`）：

| 文件 | 内容 |
|---|---|
| `calibrate-0deg.png` / `calibrate-90deg.png` | 标定屏：板框+地标（J1 Type-C 座 / J2 电源端子）、0°/90°/180°/270° 旋转钮、✓锁定 |
| `batch-ask.png` | 批量询问框「4 颗 10千欧，一起焊？」+ 逐颗焊/一起焊 |
| `run-card-r1-declined.png` | 拒绝后逐颗模式卡片：10k / 0603 电阻 / **板子左上 · 靠Type-C 座** |
| `run-layout-thumb.png` | 焊接循环布局：卡片 2/3 + 点位缩略图 1/3（右上 1/3 约束），缩略图上当前点可见 |
| `map-full-top.png` | 全屏地图（顶面）：已完成绿淡显、当前点琥珀脉冲居中（跟随视角）、待焊灰、底面件淡描 |
| `batch-lit-run.png` / `map-amber-full.png` | 同意批量后：R3 当前 + R4 琥珀点亮（R2 绿/R1 绿），全屏琥珀视图 |
| `map-states-before-skip.png` / `map-panorama-states.png` | 四类状态全景：待焊灰/已完成绿/已跳过虚线/批量组琥珀 + 另一面淡显 |
| `run-card-bottom-mirror.png` | 背面卡片：R5 = **板子右下 · 靠Type-C 座**（顶视图坐标 (14,26) 镜像后的正确词）+「镜像」角标 |
| `map-full-bottom-mirror.png` | 背面镜像地图：标题「背面 · 镜像视图」，板框切角镜像到右下（与顶面对照），当前点在镜像位 |
| `summary.png` | 收工总结（共 12 / 焊完 11 / 跳过 1 / 用时 6 分钟） |

自动化断言（全部通过，读数来自 DOM 镜像 seam，见 §5-④）：

1. **标定变化断言**：R2 标定 0° 时卡片第三行 = 「板子正上 · 靠Type-C 座」→ 标定 90° 锁定后 = 「板子右中 · 靠Type-C 座」（刚体网格旋转：正上→右中 ✓），且重播报句同步含新词（修复 §5-② 后）。
2. **缩略图 → 全屏**：点缩略图全屏出现（`map-full` 唯一），跟随视角把当前点置于视野中心（截图证据）。
3. **批量同意**：开组句「下一组，4 颗 10千欧，位置都亮出来了，一起焊。」→ 卡片「本组 第 x/4 颗」随完成 2/4→3/4→4/4 递增 → **WebAudio 提示音计数 = 3**（完成 3 颗，修复 §5-③ 后读数 1→2→3）→ 里程碑口播「这组还剩 3 颗。」/「这组还剩最后 1 颗。」各自恰好触发一次。
4. **批量拒绝**：逐颗焊后每颗完整播报（say 日志逐条：第 1 颗…第 3 颗，含方位词与最近地标），提示音计数保持 0；最近地标动态切换验证（R3 靠「电源端子」，R1/R2 靠「Type-C 座」）。
5. **返工语义**（M1 语义 × M3 UI）：批量中短按「上一个」回 R2（状态保持已完成），再连完 3 颗。
6. **跳过**：卡片上滑（Pointer 手势）跳过 C3 → 自动跳到 LED1，播报含「注意极性。」；跳过项在地图上虚线显示。
7. **断点恢复**：多次刷新均恢复指针/标定/进度（并暴露修复 §5-①）。

## 4. 流程覆盖

导入页 → 首次运行进标定屏（未标定方位词静默「未标定方位」）→ ✓ 锁定持久化 → 批量询问（同意/拒绝双路径）→ 逐颗播报 → 返工 → 跳过 → 双面：第 11 颗起 side=bottom 自动切镜像视图与镜像词 → 收工总结。8 屏中 M3 新增/增强：标定屏、焊接循环（缩略图/全屏/批量/方位词）。

## 5. 自动化过程中发现并修复的 bug（均有回归验证）

1. **标定被进度快照覆盖（store 读改写竞态）**：锁标定与首次 start 派发的两条「get→改→put」并发互相覆盖，标定静默丢失（刷新后回到标定屏）。修复：`store/db.ts` 读写改写操作串行化（写队列）。回归：多次「锁标定→刷新→继续焊接」直达循环不再重标。
2. **重标定后重播报用旧角度**：`lockCal` 里 `setCalibDeg` 后同步 `doDispatch('replay')`，而 view ref 在渲染时才更新 → 播报仍念旧方位。修复：dispatch 前同步更新 `viewInfoRef`。回归：90° 锁定后播报立即含「板子右中」。
3. **批量提示音双计数**：`Speaker.blip()` 与 `WebAudioBeep.play()` 各记一次。修复：只保留 play() 单点记录。回归：3 次完成读数恰为 1→2→3。
4. **测试基建**：桌面自动化无法执行页面 JS（evaluate 不可用），新增 `util/testhooks.ts`：每次播报/提示音镜像到 `<body>` data 属性（`data-say-count/data-say-last/data-beep-count`），供自动化断言；正常使用零影响。另将卡片手势从 TouchEvent 迁移到 PointerEvent（手机行为一致，桌面鼠标可测）。
5. **断点恢复首条播报缺方位词**（§3-7 中发现，同类时序问题）：挂载时同步 ref 后再 startLoop。回归：刷新恢复后首句含「板子正中，靠电源端子」。

## 6. 已知限制 / 移交

- 真机清单 `docs/qa/m3/device.md` 8 项阻塞待机（orientation.lock、捏合手感、脉冲流畅度、实板方位核对等）。
- 翻面确认/重标流程、批量阈值设置、报菜名、收尾清单按计划属 M4。
- iOS 旋转补偿用 `screen.orientation.angle` 确定性补偿（`effectiveDeg`），正负号需真机核对（device.md #2）。
