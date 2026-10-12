# M5 摩擦清单（真板实战回填）

> 来源：真实板转换 + 安卓模拟器（WHPX, API 34, Chrome）全流程演练，2026-10-11/12。
> 每条摩擦：现象 / 根因 / 修复 commit / 回归测试。**真板实焊的摩擦**将在实焊后追加（见 §4 待办）。

## F1 · webapp loader 拒收合法坐标（dec3 浮点表示缺陷）

- **现象**：真板 boardA（electrical-trigger，KiCad）导入时被拒：`E_DECIMALS: 'x_mm' has more than 3 decimal places (at meta.landmarks[0].x_mm)`，共 5 处（8.05 / 16.106），而 Python 侧 `tools/validate_stj.py` 放行。
- **根因**：`webapp/src/loader/validate.ts` 的 `dec3 = v*1000 === Math.round(v*1000)` 精确比较在 IEEE754 下过敏——`8.05*1000 = 8050.000000000001`，合法 3 位小数值被误杀。
- **修复**：容差比较 `Math.abs(v*1000 - Math.round(v*1000)) < 1e-6`（`ab9a019` 之后的 M5 提交）。
- **回归**：`webapp/src/loader/loader.test.ts`「dec3 tolerant compare」2 例（8.05/16.106 通过；8.05001 仍拒）；`converter/tests/test_real.py::assert_dec3_everywhere` 对真实样例全量校验。

## F2 · 卡片上滑跳过在 Chrome/Android 被浏览器吞掉（touch-action 缺失）

- **现象**：模拟器 Chrome 里卡片上滑 10 次仅偶发生效；`adb shell input swipe` 多数被浏览器接管为滚动（pointercancel），跳过未触发。真机 Chrome/独立 PWA 也会有同类风险。
- **根因**：`.run-card` 未设 `touch-action: none`，竖直拖动默认允许页面平移，浏览器在滚动判定后取消指针事件流。
- **修复**：`.run-card { touch-action: none; }`（M5 提交）。
- **回归**：CSS 属性无单测通道；模拟器受控复验（600ms 慢速上滑 → 指针恰好 +1，且缩略图跳过标记出现）；桌面 IAB 的拖拽注入在 M4 场景 b 已证明逻辑正确（2 颗跳过 → 收尾清单 2 项）。

## F3 · IndexedDB v1→v2 升级被旧页面阻塞（假死）

- **现象**：加设置库（DB v2）后，另一打开页持有 v1 连接且不响应 versionchange → 新页 `indexedDB.open` 永久挂起，首页任务列表空白。
- **根因**：`store/db.ts` 未处理 `onversionchange`/`onblocked`。
- **修复**：连接挂 `onversionchange` 自动关闭并失效缓存 promise；`onblocked` 显式 reject（M5 提交）。
- **回归**：模拟器复验（关旧页后升级立即可用）；单测通道为浏览器行为，无 vitest 用例（DB 行为属 IndexedDB 语义）。

## F4 · JLC 真实 CSV 的野字符位号与表头（已兼容，留档）

- **现象**：2dgimbal v1.3 BOM/坐标出现 `C*1`、`0603_C`、`0603 (footprint 列带后缀)` 等真实花样；坐标为左下原点。
- **根因/处理**：M2 的表头嗅探与坐标翻转已覆盖，未修代码；作为金样固化防回归。
- **回归**：`converter/tests/test_real.py::test_jlc_real_trimmed`（野字符位号存活、坐标翻转为 canonical、dec3 全净）。

## F5 · adb 注入点击吞失 / Chrome 首启向导（测试环境项，非产品缺陷）

- **现象**：模拟器自动化中 ~30% 的 `input tap` 静默丢失；Chrome 首启向导多层弹窗；`/sdcard` 被 Git Bash 路径转换改写。
- **根因**：IAB 输入注入的节奏问题 + SW 双段更新时序；属测试基建。
- **对策（留档给 M5 实测）**：每步操作后读屏验证、失败重试一次；重载后等 ≥3s；坐标从实时 `get_visible_dom` rect 计算；文件推送用 `MSYS_NO_PATHCONV=1`。

## 4. 待办（实焊后回填）

- 真板 ×2 实焊摩擦（TTS 实际音色/延迟、光照下对比度、手感节奏）。
- `--check` 统计与「对着元件袋人工数数」并排核对（boardA: 33 颗/22 组/极性 4；boardB: 108 颗/23 组/极性 12）。
- 真机（非模拟器）清单：`docs/qa/m3/device.md`、`docs/qa/m4/device.md`。
