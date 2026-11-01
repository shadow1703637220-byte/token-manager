# 本地 Token 管家

领了一堆大模型免费额度（DeepSeek、Kimi、硅基流动、各种中转站……），却不知道每个还剩多少、什么时候过期——这个工具把它们放在一个面板里看。

**下载**：去本仓库的 [Releases](https://github.com/shadow1703637220-byte/token-manager/releases) 页下载对应系统的安装包（Windows exe / Mac zip / Linux），使用与安装说明见 [RELEASE.md](RELEASE.md)。当前版本 **v1.0.0**，程序内置更新提醒，有新版本时页面顶部会出现横幅。

**特点**
- 全部在本机运行：Key 只存在你电脑的用户目录里，刷新时由本机直连各平台官方接口，不经过任何第三方服务器，无账号、无统计
- 能自动查的：DeepSeek、硅基流动、Kimi/Moonshot、OpenRouter、智谱 GLM Coding Plan、NewAPI/OneAPI 类中转站（含自研网关的多路兜底）
- 查不了的（OpenAI/订阅制等无余额接口的）：用「手动记账」卡片和「自记额度任务栏」兜底，任务栏条目也能存 Key、填网址、设周期自动恢复
- 低余额、快到期自动标黄/标红；每张卡带充值跳转，用光了点一下直达
- 零依赖：一份 Node 源码就是全部（server.js），发行包是把它打包成的单文件程序

**从源码运行**：装好 Node 18+ 后，`node server.js`，浏览器打开 http://127.0.0.1:3210 ；测试 `node test.js`（31 项）；打包发行版 `node build-dist.js all`。

## ☕ 请作者喝杯咖啡

这个工具免费开源。如果它帮你省下了逐个登录查额度的麻烦，欢迎请作者喝杯咖啡，多少随心意。

| 微信 | 支付宝 |
| --- | --- |
| <img src="https://nixinhai.de5.net/assets/pay/wechat-pay.svg" width="180" alt="微信收款码"> | <img src="https://nixinhai.de5.net/assets/pay/alipay-pay.svg" width="180" alt="支付宝收款码"> |

---

## 更新日志

### v1.0.1（2026-11-01）
- 新图标：黄圆 TOKENS + 游戏手柄结合款（半调网纹底、硬偏移黑影）。
- Mac 版修程序坞无图标：启动器改为与服务器同生共死，运行期间程序坞常驻图标，右键「退出」即停服务（此前是甩后台秒退，程序坞永无图标、关窗服务还在跑）。
- 页面底部新增「☕ 请作者喝杯咖啡」入口，点开展示微信 / 支付宝收款码。

### v1.0.0 正式发布（2026-10-31）
- 浅色产品风界面（#F5F7FA / 靛蓝 #6366F1）+ 交互动效（悬停上浮、按压回弹、进度条平滑过渡）；内置更新检查：启动后向本仓库 Releases 查询最新版本，有更新时顶部横幅提醒（仓库/网络不可达时静默）。

## v3.0 发行版（2026-10-31）
- 目标升级：从自用工具做成「所有人下载就能装」的软件（用户拍板）。server.js 加 TM_DIST 发行模式：数据改存系统用户目录（Win %APPDATA%\TokenManager、Mac ~/Library/Application Support/TokenManager、Linux ~/.local/share/TokenManager），启动自动开浏览器，端口被占时只开浏览器；旧用法（node server.js、数据在源码旁）行为不变，TM_DATA_DIR 可覆盖。
- 打包脚本 build-dist.js：Windows 用 Node SEA 单文件 exe（postject 注入）；Mac 走 .app 套装（包内放官方原版 node 二进制不注入，保住 Node 官方签名，用户只需右键打开一次；arm64/x64 两包，包名 ASCII 防 zip 编码坑）；Linux SEA 主要用于本机验管线。产物在 dist/：Windows exe 89.7MB、Mac 两包约 38/39MB、Linux 121MB。验证状态：Linux 成品已实跑全流程（数据落用户目录、条目 Key 存/看通）；Win/Mac 为构建+结构/架构校验通过，未在真机运行，待用户 Mac 真机验 arm64 包。发行说明见 RELEASE.md。

## v2.7 更新（2026-10-31）
- 自记额度任务栏条目也能存 Key：添加表单新增 Key 输入框，条目 meta 行显示脱敏 Key、点 👁 看完整（GET /api/items/:id/key 点时取回、列表只给 keyMask），条目旁新增「Key」按钮可补填/更换/清除。用户截图里已有的「路线开放」「智谱」两条可直接点 Key 按钮补录。开发插曲：首版补丁把 Key 按钮误插进账户卡片渲染（锚点「网址</button>」先命中了「改网址」），被新增的条目桩渲染测试当场抓住并修正——桩渲染断言已扩展到条目（showItemKey 点击目标 + Key 按钮存在）。

## v2.6 更新（2026-10-31）
- 新增平台「智谱 GLM (Coding Plan)」：走 open.bigmodel.cn 的 monitor 额度接口（Authorization 直接放 Key、无 Bearer 前缀，401/403 时自动换 Bearer 重试），显示 5 小时窗口 + 周窗口已用百分比、套餐等级与 5h 重置时间。注意：该接口非官方文档接口（cc-switch 等工具同款），可能随官方变动；智谱普通按量付费的账户余额官方未开放查询接口，不在此列。解析器单测 + 假 Key 实测（上游回「令牌已过期或验证不正确」）通过，真 Key 待用户验证。

## v2.5.2 修复（2026-10-31）
- v2.5.1 的 &quot; 修法让眼睛点击变成空转（属性值带引号成了字符串表达式）。改用单引号定界 onclick='showKey("id",this)'，并新增回归测试：桩渲染后断言点击目标、模拟点击验证能取回完整 Key（共 24 项）。VM 源里 HTML 改由 JSON.stringify 嵌入，根除手工转义。

## v2.5.1 修复（2026-10-31）
- v2.5 的 Key 展示 span 有一处引号转义写错，导致整页脚本失效（平台下拉为空、卡片不渲染）。已改用 &quot; 写法修复；test.js 新增「前端脚本语法可解析」防呆测试（共 23 项），今后同步前必过此关。

## v2.5 更新（2026-10-31）
- 卡片上点脱敏 Key（如 sk-****aae1 👁）即可查看完整 Key，再点收起；完整 Key 只在点击时经本机 127.0.0.1 接口临时取回，不写进页面，列表接口仍只返回脱敏值。

# 本地 Token 管家

领了一堆大模型免费额度，却不知道每个还剩多少、什么时候过期——这个工具把它们放一个面板里看。

## 怎么用（在你自己的 Mac 上）

1. 把整个 `token-manager` 文件夹放到 Mac 上
2. 打开终端，进到这个文件夹，运行：`node server.js`
   - Mac 需要装 Node（18 以上）；没装去 nodejs.org 装 LTS 版即可
3. 浏览器打开 http://127.0.0.1:3210
4. 点「添加」，选平台、粘贴 API Key，添加后自动查询一次；之后点「刷新全部」或勾选每 60 秒自动刷新

关掉终端服务就停了；数据都在同目录的 `data.json` 里。

## 能自动查的（已核实官方接口，附来源）

| 平台 | 接口 | 返回 |
|---|---|---|
| DeepSeek | `GET api.deepseek.com/user/balance` | 总余额、赠送余额、充值余额 |
| 硅基流动 | `GET api.siliconflow.cn/v1/user/info` | 总余额、赠送、充值、状态（注：官方公告该接口 2026-08-14 下线，届时等新接口） |
| Kimi/Moonshot | `GET api.moonshot.cn/v1/users/me/balance` | 可用、代金券、现金余额 |
| OpenRouter | `GET openrouter.ai/api/v1/credits` + `/auth/key` | 总 Credits、已用、Key 限额 |
| 中转站 NewAPI/OneAPI | `GET {站点}/api/usage/token/`（用 API Key）或 `/api/user/self`（用系统访问令牌+用户ID） | 总额/已用/剩余/到期；额度按 500000=$1 换算，可改 |

绝大多数领免费额度的公益站/中转站都是 NewAPI 搭的，所以「中转站」这一类才是主力：
只填站点地址 + API Key 就能查这个 Key 的额度；想查账户级余额，去中转站
「个人设置 → 安全设置」生成系统访问令牌，再把令牌和用户 ID 一起填上。

## 查不了自动的（用「手动记账」兜底）

- OpenAI / Anthropic：用量接口只给 Admin 管理员 Key，普通 Key 查不到自己的用量
- ChatGPT Plus / Claude Pro / Cursor 等订阅：根本没有余额接口

这类建一张手动卡：填总额度、已用、到期日，工具帮你算剩余、低余额标黄、到期前 7 天提醒、过期标红，至少不会白白过期。

## 提醒规则

- 剩余 < 20% 或 ≤ 0：卡片标黄/提示
- 到期 ≤ 7 天：提醒；已过期：标红

## 安全

- Key 只存在本机 `data.json`，页面上只显示前 3 + 后 4 位脱敏
- 刷新请求由本机服务直连各平台官方域名，不经过任何第三方
- `data.json` 含明文 Key：不要外传、不要提交到公开 GitHub 仓库
- 中转站的「系统访问令牌」权限比 API Key 大，能不用就只用 API Key 那条路

## v2 新增（2026-10-31）

- **自记额度任务栏**：不显示额度的平台自己建条目——名称、额度说明（自由文本）、下次刷新时间、周期（每天/每周/每月/自定义天数/不循环）。用光点复选框打勾（变灰+删除线+「已用完·等刷新」），到刷新时间自动恢复：有周期顺延下一档，不循环的恢复一次后清空时间。条目可改时间、删除；列表显示倒计时。
- **充值跳转网址**：每个账户可填 `rechargeUrl`（添加时填，或卡片上「改网址」后补）。卡片显示「💰 去充值 →」按钮；跳转优先级：自定义网址 > 手动卡旧 loginUrl > 中转站 Base URL > 官方平台主页。

## v2.4 任务栏条目网址（2026-10-31）

自记额度条目新增网址字段：添加表单可填，条目旁显示「打开网站 →」直达；已有条目点「网址」按钮可补/改/清除（走 /api/items/:id/update 的 url 字段）。

## v2.3 自研网关 /v1 接口（2026-10-31）

中转站查询加第五条路：依次试 `/v1/balance`、`/v1/key/info`、`/v1/usage`（RouteOpen 类自研网关给 Key 开的接口），用宽容解析器提取常见字段（balance/limit/spend/total_usage 等）；认不出时报错会带上返回的字段名，便于按字段名再适配。

## v2.2 改地址（2026-10-31）

中转站卡片加「改地址」按钮（POST /api/accounts/:id/base），改站点地址后自动重查；全 404 时报错内嵌自查提示（多半是把 API 调用域名填成了站点地址）。

## v2.1 中转站多路兜底（2026-10-31）

有些中转站用 Key 查不到，原因各异（站方关了 token 统计、版本路径不同、地址填了 /v1、只开了 billing 接口）。现在查询按顺序自动尝试：

1. 账户接口 `/api/user/self`（填了系统访问令牌+用户ID 时优先）
2. token 接口带斜杠 `/api/usage/token/`
3. token 接口不带斜杠 `/api/usage/token`
4. billing 接口 `/dashboard/billing/subscription` + `/dashboard/billing/usage`（总额 hard_limit_usd − 已用 total_usage/100）

并自动纠正 Base URL（去尾斜杠、去掉结尾的 /v1），请求带浏览器 UA 减少被站方拦截。全失败时卡片会列出每条路的失败原因，截图+站名即可定向适配下一家。已用本地模拟站实测三类：仅无斜杠接口的站、仅 billing 的站、全失败报错汇总。

## 测试

`node test.js` —— 9 项官方返回解析测试（用各平台文档里的真实返回结构造样例）。

## 后续可加（v2 候选）

- 智谱 GLM 等更多官方平台（逐个核实接口后再加，不猜）
- 余额历史曲线（每次刷新存一条，看消耗速度）
- 低余额/到期时本地通知、导出/导入配置
- 打包成桌面应用（Tauri/Electron）或 Mac 菜单栏常驻
