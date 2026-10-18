# M5 阶段报告 —— 真板全链路（转换 + 安卓模拟器演练）

> 执行日期：2026-10-11/12。执行 prompt：`docs/prompts/m5.md` + 用户指示「M5 用安卓虚拟机」。
> 结论先行：**两块真板全链路在安卓模拟器上走通**（转换→导入→报菜名→标定→焊接交互→收工）；摩擦回填 2 个真 bug 修复 + 1 个真机风险预防，全部带回归。**`m5-done` / `v1.0` tag 未打**——门禁中的「真板实焊 ×2」「照袋人工数数」「真机清单清零」需要实机与实焊，待 Efold 执行（见 §4）。

## 1. 真板文件与转换（门禁 #1，达成）

| 板 | 来源文件 | 产物 | 统计 |
|---|---|---|---|
| boardA electrical-trigger（MP8760 电点火板） | `electrical-trigger.kicad_pcb`（KiCad 10，E 盘项目归档） | `examples/boardA.stj.json` | 33 颗 / 22 组 / 极性 4 / 单面 / 地标 J2 接插件 |
| boardB 2dgimbal v1.3 | `2dgimbal_v1.3_bom.csv` + `2dgimbal_v1.3_positions.csv`（嘉立创生产导出） | `examples/boardB.stj.json` | 108 颗 / 23 组 / 极性 12 / 单面 / 地标 3 |

`python tools/validate_stj.py` 两侧均退出 0（仅 W_SPEAK/W_BBOX 类提示，符合设计回退）。统计与 `--check` 输出一致；「照元件袋人工数数」核对留待实焊（F 清单 §4）。

真实样例已脱敏入库：`converter/tests/fixtures-real/`（KiCad 头+边框+5 个真实器件块；JLC BOM/坐标对裁剪版，含 `C*1` 野字符位号），`converter/tests/test_real.py` 2 例防回归（源、坐标翻转、dec3 全净、位号存活）。**converter 43/43、webapp 66/66 全绿。**

## 2. 安卓虚拟机（用户指定路径，达成）

Windows 10 无自带安卓虚拟机（WSA 仅 Win11；本机 Hyper-V 关闭、无第三方模拟器）。采用官方 Android SDK 路线（dl.google.com 直连可用）：

- `D:\AndroidSdk`：cmdline-tools + platform-tools + emulator + AEHD 驱动 + `system-images;android-34;google_apis;x86_64`；JDK 17（Microsoft OpenJDK）。
- AEHD 因宿主 hypervisor（VBS）占用无法启动 → **WHPX 路径可用**（`emulator -accel-check` 确认），无需重启。
- AVD `weld-test`（Pixel 6 profile, API 34）无窗口启动，Chrome 内置；`adb reverse tcp:4173` 连接宿主 `vite preview --host 127.0.0.1`（见 F4/F5）。
- PWA 在模拟器 Chrome 中安装成功（install banner → Install）。

## 3. 真板全流程演练证据（`docs/qa/m5/`）

| 截图 | 证明 |
|---|---|
| `emu-03-tts-check-android.png` | 设置屏 TTS 体检：Android 上 64 个语音、中文 4 个 |
| `emu-04-import.png` → `emu-05-boardA-stats.png` | 文件选择器导入 boardA；统计 33/22/4/1 与 `--check` 一致 |
| `emu-06-home-boardA.png` | 首页双任务并存 |
| `emu-07-menu-boardA.png` | 报菜名屏渲染全部 22 组真件（28.7千欧…MP8760DGL-Z QFN、TestPoint×4） |
| `emu-08-calibrate-boardA.png` | 标定屏：真板 33 点位图 + J2 地标高亮，旋转生效 |
| `emu-09-loop-boardA.png` | 焊接循环：第 1/33 颗 10μF，「板子右中 · 靠J2 接插件」+ 实时缩略图 |
| `emu-10/11-rework/undo` | 短按返工、长按撤销（语义同 M1，UI 为 M3/M4 版） |
| `emu-12-skipped.png` | 上滑跳过后指针前进、方位词随位置变化（右中→右上） |
| 批量询问 | 第 30 颗 TestPoint（qty=4）触发「4 颗 TestPoint，一起焊？」→ 同意 → 提示音流 |
| `emu-13-finish-list.png`（总结版） | 全板焊完：33/33、用时 5 分钟、正面 33/33 ✓ |
| `emu-14-skip-p1.png` | touch-action 修复后受控复验：慢速上滑指针恰好 +1 |

桌面 IAB 侧（同日）M4 场景 b 已证明「跳过 → 收尾清单 → 补焊 → 全清」全链（截图 `docs/qa/m4/`），skip 标记/虚线/收尾清单渲染的证据在案。

## 4. 与 m5.md 门禁的差距（诚实清单）

| 门禁项 | 状态 |
|---|---|
| 真实文件 + 转换 + 校验 + `--check` | ✅ 完成（§1） |
| 真板实焊 ×2 并录屏（含指定交互） | ⛔ 待 Efold 实焊——模拟器已全交互演练，焊接本体需手 |
| `--check` 对元件袋人工数数 | ⛔ 待实焊前核对（数字已列 `docs/m5-friction.md` §4） |
| 真机清单清零（m3/m4 device.md） | ⛔ 大部分项已在模拟器验证（TTS/手势/标定/镜像），剩余项需真机（横竖屏锁定手感、强光对比度等） |
| 手机 PWA 更新到 M4 构建 | ✅ 以模拟器内安装等效达成；实体手机待装 |
| `m5-done` / `v1.0` tag | ⛔ 未打（按门禁不满足不打） |

## 5. 摩擦修复汇总（详见 `docs/m5-friction.md`）

1. **F1 dec3 浮点缺陷**（webapp loader 拒收合法真值）——修复 + vitest 2 例 + 真样例全量断言。
2. **F2 touch-action 缺失**（上滑跳过可被浏览器吞，真机风险）——修复 + 模拟器受控复验。
3. **F3 IDB 升级阻塞**（多页打开假死）——修复 + 模拟器复验。
4. F4 JLC 野字符位号（已兼容，金样固化）、F5 测试基建经验（adb 注入节奏）留档。

## 6. 用户试玩反馈轮（2026-10-12 补充）

Efold 模拟器试玩后四条反馈，全部落地：

| 反馈 | 修复 |
|---|---|
| 点位图糊、器件叠成一团、看不出板上位置 | 缩略图从「1.6mm 肥点」改为**真比例 body 渲染**（亚像素才退化为点） |
| 看不出器件形状，要求嘉立创式预览 | STJ 增量字段 `pads`（附录 D）：KiCad/iBOM 抽真实焊盘几何；全屏渲染 = 圆角 body + **金色铜箔焊盘** + 位号标签 + 5mm 网格点 |
| 相对大小/等高感缺失、摆放杂乱 | 真比例 + 真位置渲染自然解决（QFN 大、0603 小且等大；缩略图证据 `emu-16`，全屏焊盘证据 `emu-17-pads-full.png`） |
| 语音播报难听；位置描述要接大模型 | ① 音色评分优选（自然中文音色优先）+ 设置页音色选择器；② 转换器 `--ai-loc` 调 DeepSeek 预计算 `loc_speak`（33+108 全填，样例「MP8760左上侧」「大电感右下角」），焊接时仍离线播放 |

随手修：`notranslate` 元标签防 Chrome 自动翻译改写界面。

### 6.1 追加：器件朝向错误（Efold 指出，已修复）

竖放的电阻被画成横放。两个根因：① 渲染端从未应用器件自身的 `rot_deg`（只转了标定角）；② KiCad 转换器的 `bbox_mm` 输出的是"旋转后板框外接框"而非规格书附录 C 语义的"本体尺寸"。修复：转换器改输出本体坐标系的尺寸（pad 量级，含 pad 自转折叠）；渲染器绘制 body/pads 时应用 `rotView`（正面 = 标定角 − rot_deg，背面镜像共轭 = 标定角 + rot_deg，局部 x 翻转）。spec §bbox_mm 措辞同步钉死为"本体坐标系"。回归：金样重生成（LED1 rot90 → 本体 3.0×0.6）、converter 43/43 + webapp 68/68、模拟器实拍 `emu-18/emu-19`（横竖混排与真板一致）。

### 6.2 追加：朝向"仍不对"的系统性排查（Efold 二次反馈）

Efold 指出朝向仍不对且怀疑"只对一张图特化"。排查结论与整改：

1. **不再靠人眼**：新增 `tools/verify_orient.py` —— 用 kicad-cli 官方贴片表当
   基准答案，逐颗对比转换产物的位置/旋转/面。覆盖真板：electrical-trigger(33)、
   cantact(38)、tiny-screen(173)、2dgimbal-v1.3 嘉立创(108)，**352 颗 0 mismatch**。
2. **实测暴露并修复 3 个泛化性 bug**（回应"特化"质疑）：
   - KiCad 4 老格式（`module` 关键字，2014 年文件）解析为空板 → 兼容
     `footprint/fp_chip/module` 三代关键字；
   - 圆形板轮廓（`gr_circle`，slipring 板）未识别导致转换崩溃 → 支持；
   - **嘉立创旋转角反向**：jlc.py 对 top 件做了 `360−rot` 反向，被同设计双格式
     交叉对轴证伪（86/102 一致、零反向）→ 改为透传；`m2-contract-notes` §2 同步
     改判。
3. kicad-cli 坐标表为 y-up 贴片机约定：x 差恒定、y 和恒定，验证脚本按此对轴。

数据层结论：转换器的位置/旋转/面与 KiCad 官方输出和嘉立创原始 CSV 完全一致；
模拟器复验截图 `emu-18/19`（KiCad 板）、`emu-20/21`（嘉立创板）。
