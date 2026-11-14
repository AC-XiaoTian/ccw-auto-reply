# CCW 评论区自动回复机器人

CCW（共创世界）有人评论我的作品 / 给我留言时，自动用 AI 生成一句回复并发回去。
跑在 GitHub Actions 上，不需要服务器，不需要浏览器。

零第三方依赖，签名链路只用 Node 内置 `crypto`。

## 文件

| 文件 | 作用 |
|---|---|
| `ccw-node-client.js` | 客户端：签名、读通知、发评论/回复、删评论 |
| `ccw-auto-reply.js` | 主脚本：拉通知 → 去重 → AI 生成 → 发送 → 记状态 |
| `.github/workflows/ccw-reply.yml` | 定时任务 |
| `state.json` | 已回复过的评论 ID，防止重复回复 |

## 部署（两步就够，代码已经在仓库里）

### 1. 加 Secret

Settings → Secrets and variables → Actions → New repository secret

| Name | Value |
|---|---|
| `CCW_COOKIE` | 浏览器 F12 复制的那整行 Cookie（`token=...; cookie-user-id=...`） |
| `AI_API_KEY` | 你的 AI key（不配也能跑，会退到兜底文案） |

拿 Cookie：登录 ccw.site → F12 → Network → 随便点一个发往 `community-web.ccw.site` 的 POST 请求 →
Request Headers 里找到 `Cookie:` 整行复制。token 是 40 字符，cookie-user-id 是 24 字符。

### 2. 加 Variables（可选，同一页面 Variables 标签）

代码里已经写好了默认值（Moonshot / kimi-k3），**这一栏不填也能跑**，只有想换才填：

| Name | 默认（代码内置） |
|---|---|
| `AI_API_URL` | `https://api.moonshot.cn/v1/chat/completions` |
| `AI_MODEL` | `kimi-k3` |
| `AI_SYSTEM_PROMPT` | 内置人设（见下），填了就整段替换 |

然后去 Actions → CCW 自动回复 → Run workflow，先保持 `dry_run` 勾选看它打算回什么，
确认后再取消勾选跑一次真发。

## 频率：为什么不是"每 3 分钟跑一次任务"

GitHub 的 `schedule` 最小粒度是 5 分钟，写 `*/3` 无效，这是平台硬限制。
本项目的做法是 **5 分钟触发 + 单次运行内轮询 2 轮、间隔 150 秒**，
所以实际大约是 **2.5~3 分钟一次**。

另外两点要有预期：

- GitHub 的 cron 有 **5~30 分钟漂移**，整点前后最严重，会丢触发。
- 想真正到 1 分钟级，只能换 Cloudflare Workers 或国内云函数，GitHub Actions 到不了。

## AI 这一环（2026-11-15 实测）

用的是 Moonshot 的 key，`GET /v1/models` 只返回 `kimi-k3` 和 `kimi-k3.1-pro`。实测踩到三个坑，代码里都已经处理：

| 坑 | 现象 | 处理 |
|---|---|---|
| `temperature` 只认 1 | 传 0.7 直接 `400 invalid temperature` | 固定 `temperature: 1` |
| 推理 token 占预算 | `max_tokens: 120` / `800` 都返回**空 content**，`finish_reason` 却是别的 | 设 `max_tokens: 2000`，空 content 时打日志并退兜底文案 |
| 组织限流 3 次/分钟 | 连发 4 条就 `429 ... max RPM: 3` | 间隔 8~14 秒，429 等 3 秒重试一次，仍失败就退兜底 |

一条真实回复的用量：`prompt_tokens 327 + completion_tokens 498`（其中 `reasoning_tokens` 469），
单次调用约 12~16 秒。所以单次运行上限设 3 条，别开大。

内置人设要点（在 `ccw-auto-reply.js` 的 `AI_SYSTEM_PROMPT` 里，改一处即换风格）：
干脆、有点皮但不油的技术宅口吻；一句话 20~30 字；不自称 AI；
**不编造关卡/道具/机制细节**；不承诺更新时间、不发链接、不留联系方式；不复读原话、不引导加好友。

实测输出样例：评论「这游戏好难，第三关过不去」→
「第三关是有点卡人，我自己也卡过几回，多试几次找找手感。」

## 两个硬限制（实测，不是推测）

1. **token 只有约 16 天有效期，Node 侧不会自动续期。**
   服务端不返回 `Set-Cookie`。过期后日志报「网络故障 0000003」或者
   「无效的session(4001092401)」—— 这两个文案都跟网络无关，就是缺登录态。
   重新从浏览器复制 Cookie 更新 Secret 即可。
2. **GitHub Actions 出口 IP 是 Azure 海外机房，CCW 是否风控未验证。**
   这是整个方案里唯一没有实测覆盖的环节。若被拦，把同样四个文件
   丢到腾讯云函数 / 阿里云函数计算，代码一行都不用改。

## 接口备忘（实测参数）

| 接口 | 要点 |
|---|---|
| `POST /health/check` | body 传 `null`，返回 8 项服务 traceId，用来拼签名密钥 |
| `POST /base/dateTime` | body `{}`，返回服务器毫秒时间，用于校准 |
| `POST /notification/page` | `{"notifyGroup":"COMMENT_TO_ME","page":1,"perPage":20}` |
| `POST /comment/create` 顶层评论 | `{"content":"...","topic":{"subjectOid","subjectType","outline"}}` |
| `POST /comment/create` 回复 | 上面基础上加 `"replyToId":<评论id>` |
| `POST /study-community/comment/delete` | `{"id":<评论id>}` |

- 回复字段是 **`replyToId`**，不是 `toCommentId`，也不是 `parentId`（后两者会变成顶层评论）。
- `topic` 三个字段缺一不可：`subjectOid`、`subjectType`（`CREATION` / `PROFILE`）、`outline`。
- 留言板（`PROFILE`）**不要**传 `replyToId`，直接往对方主页 oid 发一条即可。
- 签名：`a` 头 = `HmacMD5("ccw" + body + ts, KEY)`，`b` 头 = `ts`。

## 本地调试

```powershell
$env:CCW_COOKIE='token=...; cookie-user-id=...'
$env:AI_API_URL='https://api.moonshot.cn/v1/chat/completions'
$env:AI_API_KEY='sk-...'
$env:AI_MODEL='kimi-k3'
node ccw-auto-reply.js     # 默认 dry-run，只打印
```

真发要显式开：`$env:CCW_AUTO_REPLY='1'`。

## 环境变量一览

| 变量 | 默认 | 说明 |
|---|---|---|
| `CCW_COOKIE` | — | 必填 |
| `CCW_AUTO_REPLY` | 未设 | `1` 才真发 |
| `AI_API_URL` / `AI_API_KEY` / `AI_MODEL` | Moonshot / kimi-k3 | 不配 key 则用兜底文案 |
| `CCW_REPLY_TEXT` | — | 固定文案兜底 |
| `CCW_MAX_AGE_HOURS` | 24 | 只回这么多小时内的通知 |
| `CCW_MAX_PER_RUN` | 3 | 单次最多回几条 |
| `CCW_CYCLES` | 2 | 单次运行轮询轮数 |
| `CCW_CYCLE_GAP_SEC` | 150 | 轮间隔秒数 |
| `CCW_STATE_FILE` | `./state.json` | 状态文件 |

## 风险

自动回复属于对平台的自动化操作，可能违反 CCW 用户协议，账号限流/封停风险自负。
`state.json` 里只有评论 id，不包含隐私；Cookie 只放 GitHub Secrets，不进代码。
