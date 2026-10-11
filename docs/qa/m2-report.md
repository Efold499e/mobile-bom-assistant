# M2 验收报告 —— bom2task 转换器

> 执行日期：2026-10-12。执行 prompt：`docs/prompts/m2.md`。环境：Windows 10 / Python 3.12.7。
> 结论先行：**验收 10 条全部通过**，证据真跑留档（完整 transcript 另存 `docs/qa/m2-run-log.txt`）。

## 交付物

| 文件 | 说明 |
|---|---|
| `converter/bom2task.py` | CLI 入口（格式自动嗅探 + `-b` BOM + `--check` + `--now` 测试钩子） |
| `converter/model.py` | 中间模型：分类/极性/剔除/分组/工艺默认序/STJ 组装 |
| `converter/normalize.py` | 值归一化（R/C/L 表驱动，m/M 大小写敏感，双写值落 value_speak） |
| `converter/speak.py` | speak 原子 + 封装展示名 + 高度表 |
| `converter/parsers/kicad.py` | S 表达式直解（edge.cuts 线段成环取最大外轮廓，arc 采样；pad 算 bbox） |
| `converter/parsers/jlc.py` | 双 CSV 表头嗅探（标准版/专业版），左下原点 y 向上 → canonical 翻转 |
| `converter/parsers/ibom.py` | pcbdata.json（outline + bom 矩阵取值 + bounding_box） |
| `converter/tests/` | 6 个测试文件 + 7 个 fixture + 3 份冻结金样 |
| `docs/m2-contract-notes.md` | 5 条契约备注（跨面组/嘉立创 rot 实证/极性口径/展示名/iBOM rot） |

## 验收逐条（命令 + 结果，输出原文见 run-log）

1. **unittest 全绿 0 skip**：`python -m unittest discover -s converter/tests -p "test_*.py"` → `Ran 41 tests ... OK`（41/41，0 skip）✅
2. **金样全文比对**：三格式各 1 fixture → `expected/{kicad_min,jlc_std,ibom}.stj.json`，unified diff=0（test_golden.py，含 meta/board/outline/speak/分组/group_order_default 全字段）✅。金样由 CLI 以 `--now 2026-10-11T12:00:00+08:00` 生成后冻结；重生成命令已注释在测试文件头。
3. **双面坐标陷阱**（test_parsers.KiCadBottomSideTrap + IBOMParser.test_bottom_part_not_mirrored）：R3 底面件逐字段断言 x=118-100=18.0、y=124-100=24.0（**非** 32-24 翻转）、rot 原样、side=bottom——纯平移零镜像 ✅
4. **嘉立创坐标系**（test_parsers.JLCFrameFlip）：翻转公式断言 y'=31-y（pad 后顶边）、x'=x+1（全局平移）；R1(12,26)→(13,5)、R5 底面(18,6)→(19,25) 不做镜像；底面 rot=180-0、顶面 rot=360-90=270。表头嗅探：标准版 `Designator,top x,...` 与专业版 `Designator,Mid X,...` / `评论,位号,封装` 产出**完全相等**的 task（test_jlc_std_and_pro_headers_same_result）✅
5. **归一化表驱动**：4k7/10KΩ/10000→10k；2R2→2.2Ω；0R→0Ω；104→100nF；10mF vs 10MF 分流；R/C/L 前缀定单位（同一裸数 100 在 r/c/l 下分别得 100Ω/10pF/100µH）；双写 `100nF(104)` 落 value_speak="100纳法（104）" ✅
6. **极性 + 剔除**：LED/二极管/电解（封装关键词）/IC pin1 全推断为极性；安装孔（H1）/基准点（FID）/机械件（attr board_only）默认剔除，--check 打印剔除清单 ✅
7. **默认序反例**：大顶面组仍先于小底面组（单面焊完再翻面）；大 SMD 先于小 THT；矮先于高、小先于大、gid 决定性 tie-break ✅
8. **CLI 真跑**：`python converter/bom2task.py converter/tests/fixtures/kicad_min.kicad_pcb -o build/out.json --check` 退出 0（--check 报菜名核对单打印 6 组明细 + 1 条剔除）；**三格式产物全部通过 M0 校验器**（STATS 行留档）✅
9. **依赖红线**：`grep -rnE "^\s*(import|from)\s+" converter/ --include=*.py` —— 运行时代码仅 argparse/datetime/json/sys/pathlib + 一方模块；测试文件仅 unittest/subprocess/tempfile/os/difflib/json/sys/pathlib。零第三方 ✅
10. `git tag m2-done` ✅（提交后打）

## 开发中发现并修复的缺陷（自证测试有效）

| # | 缺陷 | 发现方式 | 修复 |
|---|---|---|---|
| 1 | JLC 列索引按别名映射插入序而非 CSV 实际列序，表头顺序不同的文件会读错列 | 写 read_bom 时自查 | field→headers.index(header) |
| 2 | JLC y 翻转与平移顺序颠倒，outline 原点不为 (0,0)，被 M0 校验器当场拦下 | CLI 冒烟 + validate | Board 先 flip 后 lock_origin |
| 3 | 电容显示阶梯缺毫法档（0.01F 显示成 10000µF） | 单测 10mF 用例 | 重排显示阶梯 |
| 4 | iBOM bounding_box start/end 两点被误当坐标对列表解析 | 单测 | 按点解析取 dx,dy |
| 5 | "100" 电容三位码语义（10×10⁰=10pF）与测试期望不符 | 单测 | 修测试期望（码值语义正确） |
| 6 | 默认序排错优先级（mount 抢在 side 前） | 写码时对照 plan §8 | side 第一优先 |

## 边界遵守

- webapp/ 零改动（`git status webapp/` 干净，`npm run build` 复验通过）✅
- 未改 tools/、stj-spec.md、demo.stj.json；契约发现 → `docs/m2-contract-notes.md` ✅
- 无 --serve、无 GUI、无服务端、未调用 kicad-cli ✅
- fixtures 全部自造（含中文表头），未引入真实板子文件 ✅

## 备注

- `--now` 参数是确定金样的测试钩子；生产路径默认取当前本地时区时间。
- 金样重生成：`python converter/bom2task.py <fixture> -o converter/tests/fixtures/expected/<name>.stj.json --now 2026-10-11T12:00:00+08:00`（仅当转换规则**有意**变更时）。
