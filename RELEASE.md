# 本地 Token 管家 · 发行说明（v3.0）

一个完全在本地运行的 AI 额度管家：DeepSeek / 硅基流动 / Kimi / OpenRouter / 智谱 GLM Coding Plan / 各类 NewAPI 中转站的余额与免费额度，一页看全。所有 Key 只存在你自己电脑里，查询时由本机直连各平台官方接口，不经过任何第三方服务器。

## 下载（按你的系统选一个）

| 文件 | 适合 | 大小 |
|---|---|---|
| TokenManager-Windows.exe | Windows 10/11 64 位 | 约 90MB |
| TokenManager-Mac-arm64.zip | 苹果 M1/M2/M3/M4 芯片的 Mac | 约 38MB |
| TokenManager-Mac-x64.zip | Intel 芯片的 Mac | 约 39MB |
| TokenManager-Linux | Linux 64 位 | 约 121MB |

## 怎么用

**Windows**：双击 exe，会弹出一个黑色窗口（别关，关了就退出），浏览器自动打开管理页。第一次运行 Windows 可能提示「Windows 已保护你的电脑」——点「更多信息」→「仍要运行」即可（个人开发者没有买代码签名证书，属正常现象）。

**Mac**：解压 zip，把 TokenManager.app 拖到「应用程序」或桌面，双击打开。第一次打开若被拦截，在 Finder 里右键点 App →「打开」→ 再点「打开」，之后就能正常双击（未做苹果付费签名，属正常现象）。有 Chrome 会以独立窗口打开，没有就用默认浏览器。

**数据在哪**：你的 Key 和记录存在系统用户目录（Windows：%APPDATA%\TokenManager\data.json；Mac：~/Library/Application Support/TokenManager/data.json），卸载删掉这个文件夹即可，不留残留。

## 安全说明

- 程序只监听 127.0.0.1（只有你这台电脑能访问），Key 不上传、不统计、无账号体系。
- 唯一的联网（除查询各平台余额外）是启动后向 GitHub 官方接口查询一次"最新版本是多少"用于更新提醒，不发送任何 Key、账户或使用数据；有新版本时页面顶部会出现横幅，点过去下载新版覆盖即可。
- 页面上 Key 默认只显示前 3 后 4 位，点眼睛图标才临时取回完整 Key。
- 智谱 GLM Coding Plan 的额度查询走其官方用量页的监控接口（非公开文档接口），官方若改版可能失效，届时等更新。

## 已知限制

- OpenAI / Anthropic 官方用量接口只对管理员 Key 开放，普通 Key 查不到；订阅类（ChatGPT Plus、Claude Pro、Cursor 等）没有余额接口——这两类可用内置「手动记账」和「自记额度任务栏」管理（任务栏条目也能存 Key、点开查看）。
