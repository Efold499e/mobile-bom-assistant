# 报菜名 AI 排序接口（2026-10-24）

> 需求来源：Efold 反馈「焊接前一个个点选排序太麻烦，要能用自然语言吩咐 agent 排好顺序」。
> 结论：报菜名屏新增「AI 排序」输入框 + 按钮；调用 OpenAI 兼容的 chat-completions 接口
> （默认 DeepSeek），返回的必须是全部 gid 的排列，校验不过或网络失败时**点选排序完全不受影响**。

## 用户视角

1. 设置 → 「AI 排序（可选，需联网）」：填 API 地址（默认 `https://api.deepseek.com`）、
   API Key、模型（默认 `deepseek-chat`）。Key 只存本机 IndexedDB。
2. 报菜名屏输入一句话（例：「先焊电阻，IC 和接插件放最后」「按我袋子从上到下：
   100nF、ME6211、10k」）→ 点「AI 排序」。
3. 成功：所有组按 AI 顺序标上序号角标（等同手动全选），取料序预览实时更新，
   可直接「下一步」也可手动微调；顺序照常持久化（断点续焊保留）。
4. 失败：红字提示具体原因（未配 Key / 网络不通 / Key 无效 / 返回不完整等），已点选的顺序不变。

## 接口契约（webapp/src/ai/order.ts）

- **端点**：`POST {aiBaseUrl}/chat/completions`，OpenAI 兼容请求体：
  `{model, messages, temperature: 0, stream: false}`，头 `Authorization: Bearer <key>`。
  实测 DeepSeek 对浏览器 CORS 放行（preflight 回显 Origin、放行 POST + authorization），
  手机 PWA/APK 可直连，无中转服务。
- **消息结构**：system = 排序规则（先焊在前；必须恰为全部 gid 的排列；未提到的组按默认
  顺序接后；与工艺常识冲突时以用户指令为准；只输出 JSON 数组）；
  user = `[默认顺序]` + `[元件组清单]`（`gid|值|封装|数量|极性|类别` 每组一行）+ `[用户指令]`。
- **响应解析**：取 `choices[0].message.content`，剥 markdown 围栏后提取 `[...]` 做
  `JSON.parse`（容错抽取与 converter/ai_loc.py 同款），然后**严格校验排列**：
  元素全为字符串、与 `group_order_default` 集合完全一致、无重复——不满足即报错，绝不静默采用。
- **超时**：AbortController 30 秒。

## 错误码与文案

| code | 触发 | 提示 |
|---|---|---|
| E_AI_URL | 地址非 https / 指向本机内网 | 「API 地址仅允许 https」「不允许指向内网/本机地址」 |
| E_AI_NOKEY | 未配置 Key（发请求前拦截，零网络调用） | 「未配置 API Key：请到 设置 → AI 排序 填写」 |
| E_AI_NETWORK | fetch 抛错（断网/跨域被拦） | 「网络请求失败（检查联网；APK/PWA 需放行该域名）」 |
| E_AI_TIMEOUT | 30s 超时 | 「请求超时…」 |
| E_AI_HTTP | 401/403=Key 无效；429=限流；其他=HTTP 码 | 对应文案 |
| E_AI_FORMAT / E_AI_PERM | 回复不是 JSON 数组 / 排列不完整 | 对应文案 |

## URL 安全校验（normalizeApiBase）

与 converter/ai_loc.py 的 SSRF 规则一致：仅 https；拒绝 `localhost`、`*.localhost`、`*.local`
与回环/内网/链路本地段（127/8、10/8、172.16/12、192.168/16、169.254/16、0/8、`::1`、
fc00::/7、fe80::/10）；**放行** 198.18.0.0/15 与 2001:2::/48（本机代理 fake-IP DNS 模式会把
所有域名解析进该段，ai_loc.py 已有先例）。浏览器端无法做解析 IP 级校验（无 getaddrinfo），
按主机名面值判断；请求由用户浏览器/APK 发出，无服务器侧 SSRF 面。

## 隐私边界

发送内容 = 元件组元数据（值 / 封装 / 数量 / 极性 / 类别）+ 默认顺序 + 用户指令。
**不发送**：坐标、焊盘、丝印、地标、板名。设置页有同款提示。

## 设置字段（store/db.ts AppSettings）

| 字段 | 缺省 | 说明 |
|---|---|---|
| aiBaseUrl | `https://api.deepseek.com` | 尾斜杠在 normalize 时剥掉 |
| aiApiKey | 无 | 空 = AI 排序按钮报「未配置 API Key」 |
| aiModel | `deepseek-chat` | 任何 OpenAI 兼容模型名 |

归一化：字符串 trim、空串丢弃、baseUrl 去尾斜杠；旧配置文件无这三个字段时照常读取。

## 测试与验证

- `src/ai/order.test.ts` 15 例：URL 守卫（含 fake-IP 放行）、prompt 组装、围栏解析、
  排列校验四类拒绝、fetch 桩下的请求形状（URL/头/体/model 覆盖）、401/429/500/断网/超时映射、
  无 Key 零网络调用。webapp 84/84 全绿；converter 43/43 不受影响。
- UI 冒烟（浏览器，证据 `docs/qa/ai-menu/`）：报菜名屏出现输入框与按钮；无 Key 点按
  显示引导错误；手动点选不受影响；`用默认顺序`/`下一步` 行为不变。
- 真机待验（并入 T 清单口径）：真实 Key 下一次成功 AI 排序 + 断网兜底提示。

## 边界与后续

- 不新增 dispatcher 指令：AI 顺序走既有 `picked` → `onStart(picks)` → `persistPickOrder`，
  与手动点选完全同路。
- 下次 `npm run sync:native` 重新打包 APK 后，安卓壳自带该功能（WebView 直连，
  Capacitor 不拦 https 出网）。
- backlog 候选：AI 排序历史记忆（同板记住上次的指令）、把 `--ai-loc` 与排序合并成一次调用。
