# M1 验收报告 —— webapp 核心循环（能开焊的最小产品）

> 执行日期：2026-10-11。执行 prompt：`docs/prompts/m1.md`。环境：Windows 10 / node v24.18.0 / vite 8.3 / preact 10.29 / TypeScript 6.0 / vite-plugin-pwa 2.0。
> 结论先行：**验收 1–4 条（自动化部分）全部通过，第 5 条（真机）阻塞待机**（见 `docs/qa/m1/device.md`），第 6 条 tag 已打。

## 0. 开工前核对记录

按用户要求开工前核对了两项外部依赖，均未获答复，按推荐默认执行：
- **PWA 托管平台**：暂不定。本地 `vite preview` 开发验收；真机可用 `adb reverse tcp:4173 tcp:4173` 获得 localhost 等价能力（SW/WakeLock 完整）。决策推迟至 M4/M5 前。
- **安卓真机**：按 m1.md 预留路径，自动化先行，真机清单标「阻塞待机」。

另：npm 官方源在本网络不可达（挂起），改用 npmmirror 镜像安装（13 秒装完 387 包），仅安装行为，不进代码。

## 1. 单元测试（vitest）——27/27 全绿

```
$ npm run test
✓ src/dispatcher/dispatcher.test.ts  (7 tests)   蛇形↔返工走查/撤销/队首无效/跳过/收工/持久化/resumePosition
✓ src/speaker/sentence.test.ts       (7 tests)   句模板/极性追加/speak回退/收工句/mock speechSynthesis(cancel先行+0.9×)
✓ src/loader/loader.test.ts          (9 tests)   demo 通过/统计基线/六类坏 STJ 拒收
✓ src/planner/snake.test.ts          (4 tests)   demo 全队列序/跨行回绕蛇形/单带容差
Test Files 4 passed (4), Tests 27 passed (27)
```

必测项对照：planner 蛇形（含跨行回绕：两行 y 差 2mm、带高 1.5mm → 第二行反向）✓；dispatcher 全操作语义（§2.2 返工走查完整状态序列、误按撤销双段震动、队首短按无效震动 120ms）✓；loader 拒收（version/missing/dangling 三类 TS 版 + qty/时区/负坐标，与 M0 校验器对齐）✓；speaker 拼句 + mock speechSynthesis ✓。

## 2. 构建与 PWA

```
$ npm run build   → tsc -b && vite build
✓ 26 modules transformed, dist/assets/index-*.js 46.4KB (gzip 17.3KB)
PWA v2.0.0  mode generateSW  precache 12 entries (67.24 KiB) → dist/sw.js + manifest.webmanifest
```

图标：`public/icons/pwa-192.png / pwa-512.png`（Pillow 生成，深底琥珀焊点），manifest 中文、深色、竖屏 standalone。

## 3. 浏览器自动化一镜到底（ZCode browser-use，dist 产物 preview 服务，390×844 视口）

全部步骤真实点击/事件注入，逐步截图存 `docs/qa/m1/smoke-*.png`：

| 步骤 | 断言 | 结果 |
|---|---|---|
| 1. 首页载入，内置演示任务自动种入 | demo-board 卡片「12 颗/5 组 · 来源 hand」 | ✅ smoke-01 |
| 2. 开始焊接 → 循环屏 | 卡片 10k / 0603 电阻 / 第 1/12 颗 / 正面徽标 | ✅ smoke-02 |
| 3. 完成 ×3 | 「第 4/12 颗」+ 进度条 25% | ✅ smoke-03 |
| 4. 短按上一个（pointerdown+up） | 「第 3/12 颗」，状态不变（随后完成回第 4 证明） | ✅ smoke-04 |
| 5. 重焊完成 | 「第 4/12 颗」（返工走查闭环，§2.2 指定用例） | ✅ |
| 6. 长按上一个 750ms | 按住时按钮变「撤销待焊」；松开后 IndexedDB：`statuses[R3]='pending'`、`pointer=2`、双段震动 | ✅ smoke-05 |
| 7. 卡片上滑跳过（注入 TouchEvent） | `statuses[R3]='skipped'`、指针跳「第 4/12 颗」 | ✅ smoke-06 |
| 8. **刷新页面** | 首页「焊到第 4/12 颗」+「跳过 1」徽标；继续焊接 → 「第 4/12 颗」，状态还原 | ✅ smoke-07 |
| 9. 继续焊完剩余 9 颗 | 总结屏「收工 🎉 共 12 颗 / 焊完 11 颗 · 用时 1 分钟 / 跳过 1 颗」 | ✅ smoke-08 |

第 8 步发现并修复一个真实缺陷：首页续焊位置原用 `done+1` 计算，有跳过件时显示错位（显示 3/12，实际应 4/12）。修复 = 快照新增 `resumeAt`（`resumePosition()`：指针停在待焊件则用指针，否则推进到第一个待焊）+ Run 屏恢复时同样推进。修复后复跑全流程通过，并补单测（dispatcher.test.ts resumePosition 用例）。

## 4. 导入流程真验 + PWA 离线

- **导入统计对照**：走「导入任务 → 粘贴 JSON → 校验」路径，确认页显示 **demo-board / 来源 hand / 12颗 / 5组 / 3极性 / 2面 / 板框 45×32mm / 地标 2 个 / 提示 9 条**，与 `python tools/check_demo.py` 输出（placements=12 groups=5 polarity=3 sides=2 landmarks=2）逐项一致 ✅（smoke-09，文件选择入口在无头环境不可用，按 m1.md 应急入口验证；同源文件同一路径）。
- **PWA 离线**：`navigator.serviceWorker` 已注册，workbox-precache 9 entries；**停掉 preview 服务器进程后 reload**——页面完整从 SW 缓存启动，重置进度 → 开始焊接 → 完成 → 第 2/12 颗全程可用 ✅（smoke-10；比 DevTools Offline 开关更严格的等价证据）。

## 5. 真机清单

**阻塞待机** —— 6 项（TTS 音色/出声延迟/盲点/常亮/杀进程恢复/深色可读）待安卓测试机就绪后按 `docs/qa/m1/device.md` 补验。设备要求与 `adb reverse` 补验路径已写入该文件。

## 6. 边界遵守

- 未建 `converter/`；未改 `tools/`、`docs/stj-spec.md`、`demo.stj.json`（全部只读）✓
- 未做：点位图/缩略图/方位行（卡片第三行留空）/朝向标定/批量询问（批量组逐颗完整播报）/报菜名屏/收尾清单/设置屏/翻面衔接 ✓
- 无 ASR/蓝牙/`--serve`；无 UI 组件库（纯手写 CSS）✓
- 下方控制区严格三按钮 1fr/1fr/2fr，未增删 ✓

## 7. 契约疑点与备注

1. **导入同名项目覆盖既有记录**（taskId=project 名，put 语义 upsert）：同板重导合理，但会把进度清零。M4 收尾清单时若要「同名导入保留进度」需升级 store 语义。
2. **iOS 手势解锁**挂在首页「开始焊接」点击里（`speaker.unlock()`），真机无 iOS 目标，iOS 兼容不承诺（plan §13 既定）。
3. **演示任务演示路径已冻结**：smoke-08 总结屏的用时显示「1 分钟」（实际用时约 40 秒，`Math.max(1, round())` 取整下限），符合设计。
4. TTS 在无头/桌面 webview 无中文语音包时不发声，自动走 WebAudio 提示音兜底（流程不瘫）；真实听感待真机项 #1。
