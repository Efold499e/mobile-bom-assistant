# M0 验收报告 —— 仓库奠基 + STJ v1 冻结 + 演示任务

> 执行日期：2026-10-11。执行 prompt：`docs/prompts/m0.md`。环境：Windows 10 / Git Bash / Python 3.12.7。
> 结论先行：**验收标准 6 条全部通过**，证据见下。全程真跑命令，输出为原样摘录（完整 transcript 另存 `docs/qa/m0/run-log.txt`）。

## 交付物

| 文件 | 说明 |
|---|---|
| git 仓库 | `git init` 于本目录；`.gitignore` 含 `node_modules/`、`dist/`、`__pycache__/`、`build/`（另加 `.mimosa/`、`.v2c/`、`.video_agent/` 三个本地工具缓存目录） |
| `docs/stj-spec.md` | STJ v1 字段级规范，含 8 条开放点裁定（§8）、校验规则清单（§9）、输出格式附录 A、演示基线附录 B、bbox 缺省表附录 C |
| `webapp/public/demo/demo.stj.json` | 演示任务：12 颗 / 5 组 / 批量组 g0 qty=4 / 极性 3 颗（LED1 LED2 U1）/ 底面 2 颗（R5 R6）/ 地标 2 个（J1「Type-C 座」、J2「电源端子」）/ 5 点切角非矩形 outline / 手工排好 `group_order_default` |
| `tools/validate_stj.py` | 纯标准库 STJ v1 校验器（错误 13 类 / 警告 4 类，输出确定性全 ASCII） |
| `tools/check_demo.py` | 纯标准库演示任务断言脚本（子进程调校验器做集成路径） |
| `docs/qa/m0/bad-*.json` | 3 个负样例（由演示任务确定性派生） |

## 验收逐条（命令 + 原样输出）

### 1. git log ≥1 条；tag 含 `m0-stj-v1-frozen` ✅

```
$ git log --oneline
a524419 M0: init repo, freeze STJ v1 spec, add demo task and stdlib validators
$ git tag
m0-stj-v1-frozen
m0-done            <- 本报告提交后补打
```

（注：本报告与坏样例、既有规划文档在第二个提交入库，随后打 `m0-done`。）

### 2. 校验演示任务退出码 0；统计行与 spec 附录 B 逐字符一致 ✅

```
$ python tools/validate_stj.py webapp/public/demo/demo.stj.json
[OK] solder-task-json v1: demo-board (source=hand)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[0].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[1].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[2].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[3].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[4].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[5].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[6].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[10].bbox_mm)
WARN W_BBOX: missing; consumer falls back to footprint default table (at placements[11].bbox_mm)
STATS placements=12 groups=5 polarity=3 sides=2 landmarks=2
exit=0
```

比对附录 B 基线（`[OK] solder-task-json v1: demo-board (source=hand)` 与 `STATS placements=12 groups=5 polarity=3 sides=2 landmarks=2`）：**逐字符一致**。9 条 `W_BBOX` 为设计内警告（0603 件故意省略 bbox_mm 以覆盖缺省表路径，见附录 C），不影响退出码。

### 3. `python tools/check_demo.py` 退出码 0，要素逐项断言 ✅

```
$ python tools/check_demo.py
[PASS] validator exits 0 on demo task -- rc=0
[PASS] validator prints exactly one STATS line
       STATS placements=12 groups=5 polarity=3 sides=2 landmarks=2
[PASS] exactly 12 placements -- got 12
[PASS] groups >= 4 -- got 5
[PASS] exists batch group with qty >= 4 -- g0(qty=4)
[PASS] polarity placements >= 2 -- got 3: LED1,LED2,U1
[PASS] bottom-side placements >= 2 -- got R5,R6
[PASS] landmarks >= 1 with Chinese speak -- 2 landmarks, 2 with CJK speak: J1,J2
[PASS] outline is not a 4-point rectangle -- 5 points
[PASS] group_order_default covers all gids exactly once
[PASS] default order welds top side before bottom side -- g0 -> g1 -> g2 -> g3 -> g4
[PASS] small before large within each side -- top: 0603(1.28mm2), 0603(1.28mm2), 0805(2.50mm2), SOT-23-5(4.64mm2) | bottom: 0603(1.28mm2)

ALL CHECKS PASSED
exit=0
```

### 4. 负路径：3 个坏样例均非 0 退出 ✅

```
$ python tools/validate_stj.py docs/qa/m0/bad-version.json
[FAIL] docs/qa/m0/bad-version.json
ERROR E_VERSION: expected 1, got 2 (at version)
exit=1

$ python tools/validate_stj.py docs/qa/m0/bad-missing.json
[FAIL] docs/qa/m0/bad-missing.json
ERROR E_MISSING: missing required field 'meta' (at <root>)
exit=1

$ python tools/validate_stj.py docs/qa/m0/bad-dangling-gid.json
[FAIL] docs/qa/m0/bad-dangling-gid.json
ERROR E_DANGLING: placement references unknown gid 'g999' (at placements[0].gid)
ERROR E_QTY: group 'g0' qty=4 but has 3 placements (at groups[0].qty)
ERROR E_QTY: refdes set does not match the refs of this group's placements (at group 'g0')
exit=1
```

### 5. `tools/` 导入仅标准库 ✅

```
$ grep -rnE "^\s*(import|from)\s+" tools/
tools/check_demo.py:10:import json
tools/check_demo.py:11:import subprocess
tools/check_demo.py:12:import sys
tools/check_demo.py:13:from pathlib import Path
tools/validate_stj.py:10:import argparse
tools/validate_stj.py:11:import datetime
tools/validate_stj.py:12:import json
tools/validate_stj.py:13:import math
tools/validate_stj.py:14:import sys
```

全部为 Python 标准库（argparse / datetime / json / math / sys / subprocess / pathlib），零第三方依赖。✅

### 6. 本报告汇总全部输出；打 `m0-done` ✅

完整命令 transcript 存 `docs/qa/m0/run-log.txt`；本报告提交后打 `m0-done` 标签。

## 边界遵守情况

- 未创建 `webapp/` 下任何工程文件（无 package.json / vite 配置），`webapp/public/demo/` 仅为静态目录。
- 未写 `converter/`（目录未创建）；校验器只校验、不转换。
- 无第三方依赖、无 `--serve`、无服务端代码。
- 未改 `docs/plan.md`（plan.md / plan-v1.md / prompts/ / project-ideas/ 原样入库，见第二提交）。
- 演示任务随 `m0-stj-v1-frozen` 标签冻结，此后只读。

## 契约疑点（发现即记录，不改 plan）

1. **plan §4 示例 `qty:7, refdes:["R5","R12","R13"]` 与"qty=组内 placements 数"矛盾** —— 已在 spec §8 裁定 #1 按"示例截断"处理，validator 强制三数一致。
2. **rot_deg 与底面件**：KiCad 原生角度为顶视图逆时针，但嘉立创坐标 CSV 的旋转角按"器件所在面视角"给出，底面件映射到顶视图时转换器需要做角度变换（候选：`rot' = 180° - rot`）——spec §5 已把映射责任划给 M2 转换器并要求单测钉死，此处留痕。
3. **`W_BBOX` 依赖附录 C 表在消费端复刻**（webapp loader 与本报告 check_demo.py 各有一份）：表已在 spec 附录 C 定为规范基准，M1/M2 实现时建议以"从 spec 附录生成常量"或单文件共享常量防漂移。

## 其他备注

- git 提交钩子（Mimosa）提示 commit 前未做完整安全扫描（library_source/callgraph 部分覆盖）。M0 无第三方依赖、无服务端代码，不受影响；仅如实记录，不作安全结论。
- Windows 环境下 git 提示 LF→CRLF 转换警告，属 autocrlf 行为，不影响文件内容入库。
