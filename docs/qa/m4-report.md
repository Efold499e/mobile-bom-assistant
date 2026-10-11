# M4 验收报告 —— 报菜名 + 收尾清单 + 双面衔接 + 设置（功能冻结）

> 执行日期：2026-10-11。执行 prompt：`docs/prompts/m4.md`。环境：Windows 10 / node v24.18.0 / vite 8.3 / preact 10.29。
> 结论先行：**验收 1–2、4 条（自动化部分）全部通过，第 3 条（真机）阻塞待机**（`docs/qa/m4/device.md`），第 5 条 tag `m4-done` 已打。
> **本阶段完成后功能冻结**：v1 不再加功能，M5 只修不加。自动化过程中另修复 2 个真 bug（§4）。

## 1. 单元测试（vitest）——64/64 全绿

```
$ npm run test
✓ src/runner/makeup.test.ts  (7 tests)  新增: 点选序→队列(A,C,B 断言/部分点选/非法 gid 忽略)
                                        收尾→补焊→全清状态机(finishListPids/临时队列复用 applyCommand/mergeMakeup 计时保留)
                                        设置归一化(缺省/垃圾值/钳位0.7-1.2/threshold null=关/幂等往返)
✓ src/boardmap/geo.test.ts   (14 tests) M3 保持绿
✓ src/runner/batch.test.ts   (8 tests)  M3 保持绿（BatchTracker 构造参数化阈值，默认不变）
✓ src/speaker/sentence.test.ts (14 tests) M3 保持绿 + faceDone/finishList 句已实现
✓ src/loader / dispatcher / snake       全部保持绿
```

必测项对照（m4.md §1）：点选序 → 运行队列生成 ✓（`effectiveGidOrder` + `planQueue(task, picks)` 断言与点选一致）；断点恢复还原点选序 ✓（pickOrder 存 TaskRecord、`resetRun` 清除、挂载时 `planQueue(t, rec.pickOrder)`——持久化往返经 §2-a 刷新实测）；补焊临时队列语义 ✓（纯函数状态机测试，**未新增 dispatcher 指令**：补焊只是 `initialRunner(leftovers)` + 原有 start/complete）；设置读写往返 ✓（`normalizeSettings` 幂等 + IndexedDB settings store 读写）。

## 2. 浏览器自动化（IAB，390×844，dist preview）

截图证据（`docs/qa/m4/`）：

| 文件 | 内容 |
|---|---|
| `menu-pick-order.png` | 报菜名屏：5 组芯片（值+数量+封装），g1/g3/g0 依次点选带序号角标，实时取料序预览「1.100纳法 2.ME6211 3.10千欧 4.红色 5.4.7千欧」 |
| `menu-default-list.png` / `menu-default-to-loop.png` | 用默认顺序入口 + 直达循环 |
| `a-first-card-pick-order.png` | 点选 [g1,g3,g0] 后首颗卡片 = **100nF**（第 1/12 颗，播报「0603 电容，100纳法，板子左中，靠Type-C 座」） |
| `a-resume-keeps-order.png` | 刷新恢复后首颗仍是 100nF（点选序保持，菜单不再弹出） |
| `c-flip-ask.png` | 双面衔接：正面焊完弹「正面焊完了 / 左右翻 / 上下翻」，播报「正面焊完了，翻面继续。」 |
| `c-recal-after-flip.png` | 左右翻 → 强制重标定屏 |
| `c-bottom-mirror-map.png` | 第二面首颗 R5：side=bottom，播报「4.7千欧，板子右下（镜像词）」，地图镜像视图 |
| `b-finish-list.png` | 收尾清单：恰好 2 项（C1/C2，带全局序号与点位地图琥珀标记），播报「全部播完了，进入收尾清单。」 |
| `b-summary-all-clear.png` | 补焊全清后总结：**共 12 颗 / 焊完 12 颗 · 用时 3 分钟 / 正面 10/10 ✓ / 背面 2/2 ✓** |
| `d-settings.png` | 设置屏：语速档位、批量阈值（关闭/≥2/≥4/≥6/≥8）、TTS 体检（播放测试句 + voice 清单） |
| `d-threshold6-no-ask.png` | 阈值 ≥6 时 g0（qty=4）连完 4 颗 **零询问**、逐颗播报 |

四场景断言：

- **a. 报菜名重排**：点选序 [g1,g3,g0] → 队列 100纳法→ME6211→10千欧→红色→4.7千欧（部分点选排前、其余默认序接后）；刷新恢复后首颗仍属 g1，菜单不重现（pickOrder 持久化）✓
- **b. 跳过 2 → 收尾 → 补焊 → 总结**：上滑跳过 2 颗 → 焊完其余 10 颗 → 收尾清单恰好 2 项且地图琥珀标记 → 开始补焊（临时队列，运行屏显示「补焊 第 x/2 颗」）→ 全清 → 总结用时 3 分钟（>0）、正面 10/10、背面 2/2 ✓
- **c. 双面衔接**：队列跨面处自动暂停 → 翻面确认「左右翻」→ 重标定 → 锁定后播报 R5「板子右下，靠Type-C 座」（镜像词）+ 地图镜像视图 ✓；单面任务无此步（g0-g3 全顶面时未出现）✓
- **d. 批量阈值**：≥6 时 g0（qty=4）4 颗零询问 + sayCount 正常递增（逐颗播报）；关闭时 g0+g1 七颗零询问（asks 全 0）✓；恢复默认 ≥4 后询问行为复原（M3 证据链）✓
- **附**：设置屏 TTS 体检——voice 清单 10 个、中文 3 个（Huihui/Kangkang/Yaoyao）正常列出；播放测试句进入 say 日志 ✓

## 3. 构建与回归

```
$ npm run build   → tsc -b && vite build ✓（PWA precache 正常）
$ python -m unittest discover -s converter/tests → 41 tests OK（M3 时已复验，converter 未触碰）
```

边界遵守：converter/tools/stj-spec/demo 只读；dispatcher 未新增指令语义（翻面/补焊/菜单全是既有指令 + UI 编排）；store 仅新增 settings 与 pickOrder 存取（`resetRun` 额外清 pickOrder，任务/进度 schema 未动）；无 v1.5/v2 项混入。**功能冻结线生效。**

## 4. 自动化过程中发现并修复的 bug（均回归验证）

1. **IndexedDB v1→v2 升级被旧标签页阻塞**：升版本加 settings store 时，另一打开页持有旧版连接且不响应 versionchange → `openDb` 永久挂起（首页任务列表假死）。修复：连接上挂 `onversionchange` 自动关闭并失效缓存 promise，`onblocked` 显式 reject。回归：关旧页后升级立即完成，列表恢复。
2. **报菜名路径丢标定状态**：fresh start 走 menu 分支时 `rec.calib` 未装入 state，`startWithOrder` 误判未标定 → 进标定屏。修复：挂载时任何入口路径都先装载 calib。回归：重置 → 报菜名 → 用默认顺序 → 直达循环（`menu-default-to-loop.png`）。

另：会话发现多标签页持有旧 SW/DB 导致的一系列自动化假象（点击吞失、升级阻塞），均属测试环境，不影响单页使用；已在报告此节留档。

## 5. 移交

- 真机清单 `docs/qa/m4/device.md` 6 项阻塞待机（TTS 听感、真机翻面、照袋点菜等）。
- M5 门禁待办：真机清单清零、真实设计文件（KiCad ×1 + 嘉立创 CSV 对 ×1）、手机 PWA 更新到 M4 构建。
