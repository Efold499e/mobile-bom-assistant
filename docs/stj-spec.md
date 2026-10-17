# STJ v1 规范 —— solder-task-json v1（已冻结）

> **状态：FROZEN。冻结于 2026-10-11（M0），对应 git tag `m0-stj-v1-frozen`。**
> 本文档是 plan.md §4 的字段级展开，是全项目第一块基石。冻结后本文与 demo.stj.json **只读**：
> 任何不兼容改动必须升 `version` 并另立 spec 版本；新增可选字段属向前兼容，也应在升版时补录。
> 配套校验器：`tools/validate_stj.py`（纯 Python 标准库）；演示任务：`webapp/public/demo/demo.stj.json`。

## 0. 设计原则（继承 plan §4，字段规范的出发点）

1. **groups = 袋子（菜名），placements = 点位**。顺序只存 group 序（`group_order_default`）；组内 placement 序由手机端蛇形扫描现算——单一事实源，PC 与手机不打架。
2. **语言原子 PC 端预计算**（`value_speak` / `footprint_speak` / 地标 `speak`）：读音问题在数据层修正，手机端零"读值智能"。方位词不入库，由手机端按 x/y 纯算术现组句。
3. **坐标 canonical**：mm、原点 = 板框左上、y 向下、顶视图。各解析器（M2）负责把源格式变换到该系。
4. **双面铁律**：底面器件一律存**顶视图坐标** + `side:"bottom"`，转换/存储环节**禁止镜像**；镜像只发生在手机端渲染底面视图时。翻面标定才得以成立。

## 1. 顶层结构

```json
{
  "format": "solder-task-json",
  "version": 1,
  "meta":      { "project", "source", "created_at", "board": {...}, "landmarks": [...] },
  "sides":     ["top" | "bottom", ...],
  "groups":    [ Group, ... ],
  "placements":[ Placement, ... ],
  "group_order_default": ["<gid>", ...]
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `format` | string | ✓ | 严格等于 `"solder-task-json"` |
| `version` | integer | ✓ | 严格等于 `1`（本版） |
| `meta` | object | ✓ | 见 §2 |
| `sides` | array | ✓ | 非空；元素 ∈ {`"top"`,`"bottom"`}；不重复；两者都有时必须 `["top","bottom"]` 序；必须与 placements 实际用到的 side 集合完全一致 |
| `groups` | array | ✓ | 非空；元素见 §4 |
| `placements` | array | ✓ | 非空；元素见 §5 |
| `group_order_default` | array | ✓ | 全部 gid 的一个排列（每个恰好一次），见 §6 |

## 2. meta（项目与板级元数据）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `project` | string | ✓ | 非空 |
| `source` | string | ✓ | 枚举 {`kicad`, `jlc`, `ibom`, `hand`}（v1 冻结集合；`hand` = 手写任务） |
| `created_at` | string | ✓ | ISO 8601（须带时区偏移，如 `2026-10-11T12:00:00+08:00`） |
| `board` | object | ✓ | 见下 |
| `landmarks` | array | ✓ | **0–3 个**；元素见下 |

**meta.board**：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `width_mm` | number | ✓ | > 0；≤3 位小数；必须等于 outline 外接框宽 |
| `height_mm` | number | ✓ | > 0；≤3 位小数；必须等于 outline 外接框高 |
| `outline` | array | ✓ | **≥3 个 `[x_mm, y_mm]` 点**，顶视图多边形（不显式闭合：首尾点不重复）；所有坐标 ≥ 0、≤3 位小数；**min(x)=0 且 min(y)=0**（原点=板框左上） |

板框保真度三档（KiCad edge.cuts 多边形 > pcbdata outline > 嘉立创外接框+5mm 外推）只影响 outline 形状本身，字段结构不变。

**meta.landmarks[i]**（朝向标定用的参照物）：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `ref` | string | ✓ | 非空；地标之间不重复；**不要求**出现在 placements 中（被剔除的接插件/机械件仍可作地标） |
| `speak` | string | ✓ | 非空；TTS 直读的中文名（如 `Type-C 座`） |
| `x_mm`, `y_mm` | number | ✓ | canonical 坐标 |

## 3. sides

枚举只有 `"top"` / `"bottom"`。`sides` 必须恰好等于 placements 出现过的 side 集合：单面板 `["top"]`；双面板 `["top","bottom"]`。没有 placements 的面不得列出。

## 4. Group（袋子/菜名）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `gid` | string | ✓ | 非空；全文件唯一；字符集 `[A-Za-z0-9_-]` |
| `kind` | string | ✓ | 枚举：`r` 电阻 / `c` 电容 / `l` 电感 / `d` 二极管 / `led` 发光二极管 / `q` 三极管 / `ic` 集成电路 / `conn` 接插件 / `sw` 开关 / `mech` 机械件 / `other` 其他。冻结集合，扩充须升版 |
| `footprint` | string | ✓ | 非空；规范化封装名（如 `0603`、`SOT-23-5`） |
| `footprint_speak` | string | ✗ | 缺省时播报端回退念 `footprint` 原文 |
| `value` | string | ✓ | 非空；规范化值（如 `10k`、`100nF`；跳线用 `0R`） |
| `value_speak` | string | ✗ | 缺省时播报端回退念 `value` 原文 |
| `polarity` | boolean | ✓ | 严格 true/false（不是 0/1） |
| `qty` | integer | ✓ | ≥ 1；**必须同时等于 `refdes` 长度和该组 placements 数**（三者一致，validator 强制） |
| `refdes` | array | ✓ | 非空字符串、组内不重复；作为集合必须与该组 placements 的 `ref` 集合完全一致（次序无关） |

## 5. Placement（点位）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `pid` | integer | ✓ | ≥ 0；全文件唯一 |
| `gid` | string | ✓ | 必须指向 groups 中已有的 gid（悬空引用 = 错误） |
| `ref` | string | ✓ | 非空；全文件唯一 |
| `side` | string | ✓ | ∈ {`top`,`bottom`}；必须出现在 `sides` 中 |
| `x_mm`, `y_mm` | number | ✓ | canonical 坐标（顶视图，含 bottom 件）；≤3 位小数；须落在板框外接框内（中心出界 ≤1mm 记警告，>1mm 记错误） |
| `rot_deg` | number | ✓ | **[0, 360)**；≤3 位小数；**正 = 顶视图逆时针**（与 KiCad `.kicad_pcb` 内 footprint 角度约定一致，源为嘉立创 CSV 时由转换器负责映射并出单测） |
| `bbox_mm` | [w, h] | ✗ | 器件外接尺寸 mm（画点位矩形用，非焊盘精确形状）；两元素 > 0、≤3 位小数。**缺省时按 `footprint` 名查附录 C 默认表，查不到用 `1.0 × 1.0` 占位** |

双面铁律重申：`side:"bottom"` 的 x/y/rot 存**顶视图**值；禁止在数据层做 `x → W-x` 之类镜像。

## 6. group_order_default

全部 gid 的排列（长度 = groups 数、每个恰好一次）。语义 = PC 端按工艺规则预排的默认取料序（先小后大、先矮后高、贴片先于插件、单面焊完再另一面）；手机端报菜名屏以此为初序，用户点选可改（改的只是手机端点选序，不改文件）。

## 7. 兼容与版本

- `format` 与 `version` **严格匹配**：`version` 不是 1 → 直接拒绝（不猜测、不降级解释）。
- **未知字段一律忽略**（对象各层级皆然）：v1.x 允许写入端携带额外信息而旧读取端不受影响。
- 校验器报错不输出任何"修复建议式转换"；校验器只校验、不转换。

## 8. 裁定记录（M0 冻结时裁定的开放点）

| # | 开放点 | 裁定 | 理由 |
|---|---|---|---|
| 1 | qty 一致性 | `qty` = `len(refdes)` = 该组 placements 数，三者强制一致；plan §4 示例 `qty:7, refdes:3` 系示例截断，不代表合法状态 | 三处不一致必然有一处是错的；在数据层堵住，手机端才能零校验地信任队列 |
| 2 | bbox_mm 可选 | 可选；缺省按封装名查附录 C，查不到用 1.0×1.0 占位 | 手写/快速任务不该被迫量尺寸；渲染占位精度足够，M2 转换器会尽量显式填 |
| 3 | rot_deg 约定 | [0,360)、正 = 顶视图逆时针，与 KiCad `.kicad_pcb` 角度原样兼容 | 查证 KiCad 文件格式：footprint 角度为度数、逆时针；以最大装机来源为主约定，其他源（嘉立创 CSV 等）由转换器映射并以单测钉死 |
| 4 | 双面坐标 | 底面一律存顶视图坐标 + `side:"bottom"`，转换/存储禁镜像；镜像只在手机渲染层 | plan §4 原裁定：否则翻面标定不成立；M2 出单测钉死 |
| 5 | speak 回退 | `value_speak`/`footprint_speak` 缺省时回退念 `value`/`footprint` 原文（地标 `speak` 必填，无回退） | 现代 TTS 念裸英文/数字基本可懂；作者只需修真正读错的，数据量最小 |
| 6 | outline | ≥3 点多边形、不显式闭合、坐标 mm、原点=板框左上、y 向下、全文件 mm 数 ≤3 位小数（1µm 精度） | 覆盖任意板形（含非矩形/带切角）；精度上限防浮点噪音入库 |
| 7 | sides / landmarks | sides 枚举 {top,bottom} 且须与 placements 实际 side 集合一致；landmarks ≤3 | sides 是事实描述不是愿望清单；标定屏最多 3 个参照，多了用户看不过来 |
| 8 | 兼容规则 | format/version 严格匹配；未知字段全层级忽略 | 严格匹配防半成品文件混入；忽略未知字段换向前兼容 |

## 9. 校验规则清单（tools/validate_stj.py 实现口径）

**错误（任一出现 → 退出码 1）**

| 代码 | 规则 |
|---|---|
| `E_JSON` | 不是合法 JSON / 顶层不是对象 |
| `E_FORMAT` | format ≠ `"solder-task-json"` |
| `E_VERSION` | version ≠ 1 |
| `E_MISSING` | 必填字段缺失（§1–§6 标 ✓ 的字段） |
| `E_TYPE` | 字段类型错（含 bool 冒充 int、非有限数 NaN/Inf、坐标点不是二元组） |
| `E_ENUM` | 取值不在冻结枚举（kind / source / side / sides 序） |
| `E_RANGE` | 数值超界（qty<1、rot_deg∉[0,360)、坐标为负、宽高与 outline 外接框不符、bbox≤0、placement 出界 >1mm） |
| `E_DECIMALS` | mm/deg 数超过 3 位小数 |
| `E_OUTLINE` | outline 点数 <3、原点不为 (0,0) |
| `E_DUP` | 重复（gid / pid / ref / 组内 refdes / landmark ref / sides 元素） |
| `E_DANGLING` | 悬空引用（placement.gid 不存在；group_order_default 出现不存在的 gid） |
| `E_QTY` | qty ≠ len(refdes) ≠ 组内 placements 数；refdes 集合 ≠ 组内 ref 集合；group_order_default 不是全 gid 排列 |
| `E_SIDES` | sides 与 placements 实际 side 集合不一致 |

**警告（打印但退出码 0）**

| 代码 | 规则 |
|---|---|
| `W_SPEAK` | value_speak / footprint_speak 缺省（回退念原文） |
| `W_BBOX` | bbox_mm 缺省（渲染时按附录 C 占位） |
| `W_EDGE` | placement 中心出板框外接框 ≤1mm |
| `W_LANDMARK` | 地标坐标在板框外接框外 |

## 附录 A：校验器输出格式（确定性，供验收比对）

成功（退出码 0）：

```
[OK] solder-task-json v1: <project> (source=<source>)
WARN <code>: <message> (at <path>)        # 仅当有警告，可多行
STATS placements=<P> groups=<G> polarity=<K> sides=<S> landmarks=<L>
```

失败（退出码 1）：

```
[FAIL] <文件路径>
ERROR <code>: <message> (at <path>)       # 可多行，全部列出
```

- `<K>` = 极性 placements 数（其所属 group `polarity:true` 的 placement 计数）。
- 输出全 ASCII，便于留档与 grep。

## 附录 B：演示任务统计基线（M0 验收比对用）

`webapp/public/demo/demo.stj.json` 校验输出必须与下面两行**逐字符一致**：

```
[OK] solder-task-json v1: demo-board (source=hand)
STATS placements=12 groups=5 polarity=3 sides=2 landmarks=2
```

## 附录 C：bbox_mm 缺省尺寸表（v1 消费端共用）

按 `footprint` 名**大小写不敏感精确匹配**；查不到 → `1.0 × 1.0`。此表为视觉占位，非焊盘精确形状；M2 转换器应尽量显式写 `bbox_mm`。

| footprint | w × h (mm) |
|---|---|
| 0402 | 1.0 × 0.5 |
| 0603 | 1.6 × 0.8 |
| 0805 | 2.0 × 1.25 |
| 1206 | 3.2 × 1.6 |
| 1210 | 3.2 × 2.5 |
| SOD-123 | 3.7 × 1.6 |
| SOT-23 | 2.9 × 2.4 |
| SOT-23-5 | 2.9 × 1.6 |
| SOT-223 | 6.5 × 3.5 |
| SOIC-8 | 4.9 × 3.9 |
| SOIC-16 | 4.9 × 6.4 |
| （其他） | 1.0 × 1.0 |

## 附录 D：增量字段（v1 冻结后的可忽略扩展，2026-10-12 M5 用户需求）

冻结规则允许「loader 可忽略的增量字段」：旧消费端遇到这些字段直接忽略，行为不变。以下字段由 M2 转换器产出，webapp loader / Python 校验器同步支持（字段级校验，出错拒绝）。

### D.1 `placements[].pads`（真实焊盘几何，渲染用）

```json
{ "pads": [ { "x_mm": -0.775, "y_mm": 0.0, "w_mm": 0.9, "h_mm": 0.95, "shape": "rect" } ] }
```

- 坐标相对**器件中心**，且在器件**自身局部坐标系**（`rot_deg` 由渲染端施加）。
- `shape` ∈ `rect | circle`（roundrect/oval 归一为 `rect`，tht 圆孔归一为 `circle`）。
- 来源：KiCad `footprint.pads`、iBOM `footprints[].pads`；嘉立创 CSV 对无几何 → 不产出（渲染端回退到 bbox 真比例绘制）。

### D.2 `placements[].loc_speak`（AI 位置描述，播报用）

```json
{ "loc_speak": "MP8760 左下侧" }
```

- 转换器 `--ai-loc` 调 DeepSeek 预计算（遵循 §4「语言原子 PC 端预计算」原则），≤24 字符；无 key/无网络时省略，消费端回退内置九宫格+地标播报。
- webapp 播报与卡片第三行优先取该字段。

同步改动：`converter/`（parsers/model/ai_loc）、`webapp/src/loader/{types,validate}.ts`、金样 `kicad_min` 重生成（diff 仅增量）。
