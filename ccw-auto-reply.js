/* ============================================================
 * 自动回复脚本（ccw-auto-reply.js）
 * 依赖：同目录 ccw-node-client.js（零第三方依赖）
 *
 * 流程：
 *   拉「回复我的」通知(/notification/page COMMENT_TO_ME)
 *   -> 按 ID 去重（state.json）
 *   -> AI 生成一句回复（AI 不可用时退回兜底文案）
 *   -> /comment/create 发回（作品评论、主页留言板都带 replyToId，挂在原留言下面）
 *   -> 校验返回体 parentId；留言板若退化成顶层新留言就立刻删掉
 *   -> 记录状态
 *
 * 双账号（2026-11-15 新增）：
 *   CCW_COOKIE      板主账号（AC小天）。用它读「AC小天留言板/作品」的通知，
 *                   也用它的身份删评论、点赞、置顶（这些操作要板主权限）。
 *   CCW_COOKIE_BOT  发言账号（蔚小喵新号）。回复一律用它的身份发出，
 *                   所以它能同时回「AC小天留言板」和「自己的留言板」。
 *                   不填就退回单账号：谁的通知谁回。
 *
 * 环境变量：
 *   CCW_COOKIE         必填，"token=...; cookie-user-id=..."
 *   CCW_COOKIE_BOT     可选，第二份 Cookie。填了就用它发所有回复
 *   CCW_AUTO_REPLY     '1' 才真发；否则 dry-run 只打印
 *   CCW_IGNORE_NICKNAMES  逗号分隔的昵称黑名单，这些账号发来的通知一律不回，默认 AI助手
 *   CCW_DELETE_IDS     逗号分隔的评论 id，只做删除、不回复（清脏数据用）
 *   AI_API_URL         留空即用内置的 Moonshot 地址
 *   AI_API_KEY         AI 的 key；不填则全部走兜底文案，不会崩
 *   AI_MODEL           模型名，默认 kimi-k3
 *   AI_SYSTEM_PROMPT   填了就整段替换内置人设
 *   CCW_REPLY_TEXT     可选，固定文案（AI 不可用时的兜底）
 *   CCW_MAX_AGE_HOURS  只回复多少小时内的通知，默认 24
 *   CCW_MAX_PER_RUN    单次运行最多回复几条，默认 3
 *   CCW_CYCLES         单次运行轮询几轮，默认 2
 *   CCW_CYCLE_GAP_SEC  两轮之间的间隔秒数，默认 150
 *   CCW_STATE_FILE     状态文件路径，默认 ./state.json
 * ============================================================ */
'use strict';

const fs = require('node:fs');
const { CCWClient } = require('./ccw-node-client');

const COOKIE = (process.env.CCW_COOKIE || '').trim();
/* 第二份 Cookie：蔚小喵自己的账号。回复用它发，删除/点赞/置顶用板主账号。
 * 空着就退回单账号行为。 */
const BOT_COOKIE = (process.env.CCW_COOKIE_BOT || '').trim();
const AUTO = process.env.CCW_AUTO_REPLY === '1';
const MAX_AGE_HOURS = Number(process.env.CCW_MAX_AGE_HOURS || '24');
const MAX_PER_RUN = Number(process.env.CCW_MAX_PER_RUN || '3');
const CYCLES = Number(process.env.CCW_CYCLES || '2');
const GAP_SEC = Number(process.env.CCW_CYCLE_GAP_SEC || '150');
const STATE_FILE = process.env.CCW_STATE_FILE || './state.json';

/* 昵称黑名单：实测「AI助手」这类账号，你一回它它又发一条新通知回来，
 * 会形成回声循环，一轮一条无限往下滚。这类账号一律不回。
 * 用 CCW_IGNORE_NICKNAMES 可以把别的官方号 / 机器人也加进来（逗号分隔）。 */
const IGNORE_NICKNAMES = (process.env.CCW_IGNORE_NICKNAMES || 'AI助手')
  .split(',').map((s) => s.trim()).filter(Boolean);

/* 清脏数据模式：只删不回复，传 ids 就退出主流程 */
const DELETE_IDS = (process.env.CCW_DELETE_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/* AI 默认指向 Moonshot(kimi)；AI_API_URL / AI_MODEL 留空即用这里的默认值。
 * 不填 AI_API_KEY 也不会崩，只是全部走兜底文案。 */
const AI_API_URL = (process.env.AI_API_URL || '').trim() ||
  'https://api.moonshot.cn/v1/chat/completions';
const AI_API_KEY = (process.env.AI_API_KEY || '').trim();
const AI_MODEL = (process.env.AI_MODEL || '').trim() || 'kimi-k3';

/* 人设：AC小天 本人在 CCW 的语气。想换风格只改这一处（或用 AI_SYSTEM_PROMPT 覆盖） */
const AI_SYSTEM_PROMPT = (process.env.AI_SYSTEM_PROMPT || '').trim() || [
  '你是"小天"，在共创世界（CCW）上做游戏和小工具的作者，正在回复自己作品评论区或主页留言板上的留言。',
  '语气：干脆、实在、有点皮但不油，像个二十多岁的技术宅，不像客服，也不像陪聊。',
  '硬性要求：',
  '1. 只说中文，一句话，20~30 个字，能短不长；',
  '2. 不自称 AI，不提模型、不提"助手""系统"；',
  '3. 不要编造游戏机制、关卡细节、道具名称——不了解就别提具体的，宁可说通用的话；',
  '4. 不承诺任何具体事情：不保证更新时间、不发资源链接、不留联系方式、不提加群；',
  '5. 被夸就老实道谢再补一句实在话；被问就正面回应，不确定就说"这个我还没试过"；',
  '6. 不用"亲""宝子""集美"，不堆叹号，最多一个表情，也可以不用；',
  '7. 不复读对方原话，不反问"要不要一起玩""加个好友"这类引导。'
].join('\n');

const FALLBACK_TEXT = process.env.CCW_REPLY_TEXT || '';
/* 首次运行只做「认领」不发送：把当前窗口内的通知全部标记成已处理，避免把你手回过的再回一遍 */
const BOOTSTRAP = process.env.CCW_BOOTSTRAP === '1';
/* 两次 AI 调用之间的最小间隔。这把 key 的组织上限是 3 次/分钟，21 秒最稳 */
const AI_MIN_INTERVAL_MS = Number(process.env.AI_MIN_INTERVAL_MS || '21000');
/* 鉴权失败（Cookie 失效）时，多少小时内不再让 run 变红，避免每轮刷失败邮件 */
const AUTH_FAIL_THROTTLE_HOURS = Number(process.env.CCW_AUTH_FAIL_THROTTLE_HOURS || '24');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/* AI 调用节流：保证任意两次调用间隔 >= AI_MIN_INTERVAL_MS */
let _lastAiAt = 0;
async function aiPace() {
  const wait = AI_MIN_INTERVAL_MS - (Date.now() - _lastAiAt);
  if (wait > 0) await sleep(wait);
  _lastAiAt = Date.now();
}

/* ---------------- 状态 ---------------- */

function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (!raw.replied || typeof raw.replied !== 'object') return { replied: {} };
    return raw;
  } catch (e) {
    return { replied: {} };
  }
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1));
  } catch (e) {
    console.warn('状态文件写入失败:', e.message);
  }
}

/* ---------------- AI ---------------- */

/* 把对方评论内容交给 AI，返回一个决策对象：
 *   { reply, pin, del, like_oid }
 * 人设里已经规定了这套 JSON 契约。AI 不听话时（返回纯文本、带 ```json 包裹、
 * 或者干脆是空），统一按「纯文本回复、不置顶、不删、不点赞」处理，不让流程崩。
 */
const EMPTY_DECISION = { reply: '', pin: false, del: false, like_oid: '' };

async function aiDecision(notice) {
  if (!AI_API_URL || !AI_API_KEY) return { ...EMPTY_DECISION };
  const incoming = String(notice.comment || '').slice(0, 500);
  if (!incoming) return { ...EMPTY_DECISION };

  const body = {
    model: AI_MODEL,
    messages: [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `有人在我的${notice.subjectType === 'PROFILE' ? '主页留言板' : '作品评论区'}留言：「${incoming}」。\n` +
          '按人设回一句，并按要求输出那个 JSON。'
      }
    ],
    temperature: 1,        // kimi-k3 只接受 1，写 0.7 会直接 400 invalid temperature
    // kimi 是推理模型：思考过程也计入 max_tokens。实测一条回复 reasoning≈470 token、
    // 正文只有≈30 token，给 120 或 800 都会返回空 content，给 2000 才稳。
    max_tokens: 2000
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await aiPace();
      const res = await fetch(AI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${AI_API_KEY}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });

      // 组织上限 3 次/分钟。sleep(3s) 仍在同一个 60 秒滑窗内，必然继续 429，
      // 所以这里退到 20 秒，最多再试 2 次。
      if (res.status === 429) {
        if (attempt < 3) {
          console.log(`   AI 限流(429)，20 秒后重试（第 ${attempt} 次）`);
          await sleep(20000);
          _lastAiAt = 0;   // 重置节流，让重试能立刻发出去
          continue;
        }
        console.log('   AI 持续限流，放弃本条，改兜底文案');
        return { ...EMPTY_DECISION };
      }
      if (!res.ok) {
        console.log('   AI 接口返回', res.status, (await res.text()).slice(0, 200));
        return { ...EMPTY_DECISION };
      }

      const data = await res.json();
      const text = (data.choices && data.choices[0] && data.choices[0].message &&
        data.choices[0].message.content) || '';
      const out = parseDecision(text);
      if (!out.reply && !out.del) console.log('   AI 没给可用内容（多半是 max_tokens 不够），改用兜底文案');
      return out;
    } catch (e) {
      console.log('   AI 调用失败:', e.message);
      return { ...EMPTY_DECISION };
    }
  }
  return { ...EMPTY_DECISION };
}

/* 把 AI 的原始输出解析成决策对象。
 * 已知的坑：kimi-k3 有时会用 ```json 包裹，有时前面加一句「好的，这是回复：」，
 * 有时干脆不按契约、只回一句人话。这三种都兜住。 */
function parseDecision(raw) {
  const text = String(raw || '').trim();
  if (!text) return { ...EMPTY_DECISION };

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const reply = clean(obj.reply || '');
      const likeOid = String(obj.like_oid || obj.likeOid || '').trim();
      return {
        reply,
        pin: obj.pin === true || obj.pin === 'true',
        del: obj.delete === true || obj.delete === 'true',
        like_oid: /^[0-9a-f]{24}$/i.test(likeOid) ? likeOid : ''
      };
    } catch (e) {
      // 落到下面按纯文本处理
    }
  }
  return { reply: clean(text), pin: false, del: false, like_oid: '' };
}

/* 从留言正文里刨作品 oid：支持 ccw.site 作品链接、/detail/<oid>、以及裸 oid。
 * AI 漏填 like_oid 时用这个兜底——用户说「帮我给这个作品点赞」时正文里一定有链接。 */
function oidFromText(s) {
  const t = String(s || '');
  const m = t.match(/(?:www\.)?ccw\.site\/(?:detail|works?|creation)\/([0-9a-f]{24})/i) ||
    t.match(/\/detail\/([0-9a-f]{24})/i) ||
    t.match(/\b([0-9a-f]{24})\b/i);
  return m ? m[1] : '';
}

/* 评论框里放不下换行，压成单行并限长 */
function clean(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, 200);
}

function pickText(notice, aiText) {
  if (aiText) return aiText;
  if (FALLBACK_TEXT) return FALLBACK_TEXT;
  return notice.subjectType === 'PROFILE' ? '谢谢你的留言～' : '谢谢支持，看到了～';
}

/* ---------------- 主流程 ---------------- */

async function oneCycle(clients, state, opts) {
  const { round, dryRun } = opts;

  /* 板主账号列：AC小天 一份；蔚小喵 新号另起一份（同一份 Cookie 就不重复拉）。 */
  const boards = [{ key: 'owner', label: 'AC小天', client: clients.owner }];
  if (clients.bot && clients.bot !== clients.owner) {
    boards.push({ key: 'bot', label: '蔚小喵自己的账号', client: clients.bot });
  }

  const bucket = [];
  const seen = new Set();
  for (const b of boards) {
    let list = [];
    try {
      list = await b.client.listReplies({ page: 1, perPage: 20 });
    } catch (e) {
      // 单份 Cookie 挂了不拖垮另一份：各自报各自的
      console.log(`[第 ${round} 轮] ${b.label} 拉通知失败：${e.message}`);
      continue;
    }
    console.log(`[第 ${round} 轮] ${b.label} 通知 ${list.length} 条`);
    for (const n of list) {
      const id = String(n.triggeredById || '');
      if (!id || seen.has(id)) continue;   // 两份通知里可能出现同一条，只处理一次
      seen.add(id);
      bucket.push(Object.assign({}, n, { _board: b.key }));
    }
  }
  console.log(`[第 ${round} 轮] 合计 ${bucket.length} 条 | 模式: ${dryRun ? 'dry-run' : '真实发送'}`);

  const now = Date.now();
  const todo = bucket
    .filter((n) => {
      const id = String(n.triggeredById || '');
      if (state.replied[id]) return false;
      // 黑名单：AI助手这类账号自问自答式回复会形成回声循环
      const nick = String(n.senderName || '');
      if (IGNORE_NICKNAMES.some((x) => nick.includes(x))) {
        console.log(`   跳过 ${nick}（在黑名单里，避免回声循环）`);
        state.replied[id] = { at: now, ignored: nick };
        return false;
      }
      const age = (now - (n.createdAt || 0)) / 3600000;
      return age <= MAX_AGE_HOURS;
    })
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))   // 先回旧的
    .slice(0, MAX_PER_RUN);

  console.log(`[第 ${round} 轮] 待回复 ${todo.length} 条（上限 ${MAX_PER_RUN}）`);
  if (!todo.length) return 0;

  let sent = 0;
  for (const n of todo) {
    const who = n.senderName || n.senderOid || '?';
    const preview = String(n.comment || '').replace(/\s+/g, ' ').slice(0, 40);
    // 板主账号：删评论 / 点赞 / 置顶 都要板主权限，用通知来源那份 Cookie
    const boardClient = n._board === 'bot' ? clients.bot : clients.owner;
    // 发言账号：所有回复都用蔚小喵身份发出，这样它能出现在两个人的留言板下
    const actorClient = clients.bot || clients.owner;
    const asBot = actorClient !== boardClient;

    const act = await aiDecision(n);
    const body = pickText(n, act.reply);
    // AI 漏填 like_oid 时，从正文里刨链接兜底：对方把作品链接贴过来求赞的情况很常见
    const likeOid = act.like_oid || oidFromText(n.comment);

    if (dryRun) {
      const tags = [];
      if (act.del) tags.push('删评论');
      if (act.pin) tags.push('置顶/点赞该评论');
      if (likeOid) tags.push('给作品 ' + likeOid + ' 点赞');
      const via = asBot ? '（以蔚小喵身份发出）' : '';
      console.log(`   [dry-run] ${who}：「${preview}」-> 「${body}」${via}${tags.length ? ' [动作: ' + tags.join(' + ') + ']' : ''}`);
      continue;
    }

    /* 1) 辱骂/广告：直接删掉对方那条评论，不回复。
     *    comment id 就是通知里的 triggeredById。删别人的评论需要板主身份，
     *    所以这里必须用 boardClient 而不是发言账号。失败也照实记录，不做重试。 */
    if (act.del) {
      const d = await boardClient.del(n.triggeredById);
      const ok = String(d && d.code) === '200';
      console.log(`   删评论 ${n.triggeredById}（${who}）-> ${ok ? '成功' : JSON.stringify(d).slice(0, 160)}`);
      state.replied[String(n.triggeredById)] = { at: now, deleted: Number(n.triggeredById), delOk: ok };
      await sleep(rand(3000, 6000));
      continue;
    }

    /* 2) 对方贴了作品链接求赞：先点作品赞，再回复（顺序按用户要求） */
    if (likeOid) {
      const r = await boardClient.likeCreation(likeOid);
      const ok = String(r && r.code) === '200';
      console.log(`   作品点赞 ${likeOid} -> ${ok ? '成功' : JSON.stringify(r).slice(0, 160)}`);
      await sleep(rand(2000, 4000));
    }

    /* 3) 对方夸我：给这条评论点赞，并尝试置顶。
     *    置顶实测是官方权限（自己作品下也报「作品仅允许作者操作」），
     *    所以置顶必然失败，只记一行日志，不当成错误，也不重试。 */
    if (act.pin) {
      const lr = await boardClient.likeComment(n.triggeredById);
      console.log(`   评论点赞 ${n.triggeredById} -> ${String(lr && lr.code) === '200' ? '成功' : JSON.stringify(lr).slice(0, 120)}`);
      const pr = await boardClient.pinComment(n.triggeredById);
      const pinOk = String(pr && pr.code) === '200';
      console.log(`   置顶尝试 ${n.triggeredById} -> ${pinOk ? '成功' : '被拒（' + String((pr && pr.msg) || '').slice(0, 40) + '）'}`);
      await sleep(rand(2000, 4000));
    }

    const r = await actorClient.replyToNotice(n, body);
    if (r && String(r.code) === '200') {
      const created = (r.body && r.body.id) || null;
      const parent = (r.body && r.body.parentId) || null;
      // 留言板：如果服务端没把它挂到原留言下（parentId 为空），就是在板上多发了一条独立留言，
      // 用户看不到"回复"。这种情况立刻删掉这条（用发出它的那个账号删），并且这次不再重试。
      if (n.subjectType === 'PROFILE' && !parent) {
        console.log(`   留言板未支持嵌套（parentId 为空），已删除退回顶层的 id=${created}` +
          (asBot ? '（注意：这条是蔚小喵账号发的，可能是跨账号嵌套不被支持）' : ''));
        if (created) await actorClient.del(created);
        state.replied[String(n.triggeredById)] = { at: now, nested: false, deleted: created, viaBot: asBot };
        continue;
      }
      state.replied[String(n.triggeredById)] = {
        at: now, id: created, parentId: parent, board: n._board, viaBot: asBot,
        ...(likeOid ? { likedOid: likeOid } : {}),
        ...(act.pin ? { pinned: true } : {})
      };
      sent += 1;
      console.log(`   已回复 ${who} -> commentId ${created}${parent ? ' parentId=' + parent : ''}` +
        (asBot ? '（蔚小喵身份）' : ''));
    } else {
      console.log(`   失败 ${who}: ${JSON.stringify(r).slice(0, 200)}`);
    }
    // 间隔随机化：既防风控，也避开 AI 的 3 次/分钟限流
    await sleep(rand(8000, 14000));
  }
  return sent;
}

(async () => {
  if (!COOKIE) {
    console.error('缺少环境变量 CCW_COOKIE（形如 token=...; cookie-user-id=...）');
    process.exit(1);
  }

  const client = new CCWClient({ cookie: COOKIE });
  /* 第二份 Cookie：蔚小喵新号。它既用来发回复（两个留言板都用它的身份），
   * 也用来读它自己那边的通知。没配就退回「谁的通知谁回」。 */
  const botClient = BOT_COOKIE ? new CCWClient({ cookie: BOT_COOKIE }) : null;
  const clients = { owner: client, bot: client };

  /* 身份输出：Cookie 里的 cookie-user-id 就是账号 oid（和 CCW 页面 URL 里那个一致）。
   * 出问题时不用猜「到底哪份 Cookie 是哪个号」，一眼能看出来。
   * 注意：只打 oid，不打 token。 */
  const oidOf = (ck) => {
    const m = /cookie-user-id=([0-9a-zA-Z]+)/.exec(ck || '');
    return m ? m[1] : '(Cookie 里没有 cookie-user-id)';
  };
  console.log('CCW_COOKIE     身份 oid=' + oidOf(COOKIE));
  if (BOT_COOKIE) console.log('CCW_COOKIE_BOT 身份 oid=' + oidOf(BOT_COOKIE));

  try {
    await client.init();
  } catch (e) {
    console.error('签名初始化失败:', e.message);
    console.error('最常见原因：Cookie 里的 token 失效了（登录态过期）。' +
      '前端写入这份 cookie 时给的是 180 天，但服务端真正认多久没有公开数据，可能远短于此。' +
      '注意这时接口可能返回「网络故障 0000003」，那不是网络问题，是缺登录态。');
    process.exit(1);
  }
  console.log('签名就绪');

  /* 第二份 Cookie（蔚小喵账号）：只在它真的能读通知时才启用。
   * 两个坑：
   *   1. init() 只取签名密钥，health/check 无论有没有登录都返回正常，签名成功 ≠ session 活着；
   *   2. 它一旦抛错，绝不能把主号一起带崩（最初版本就是这么写的，第二份 Cookie 一失效整轮全挂）。
   * 所以这里单独 try，并且额外做一次真正需要身份的读通知，失败就退化成单账号。 */
  if (BOT_COOKIE) {
    try {
      await botClient.init();
      const probe = await botClient.listReplies({ page: 1, perPage: 1 });
      if (!Array.isArray(probe)) throw new Error('读通知返回非数组');
      clients.bot = botClient;
      console.log('第二份 Cookie（CCW_COOKIE_BOT）可用，回复将以它的身份发出');
    } catch (e) {
      console.log('::warning::第二份 Cookie 不可用（' + String(e.message).slice(0, 90) +
        '），本次退化成单账号，只用 CCW_COOKIE 那个账号读通知并回复。');
    }
  }

  /* 主号 Cookie 也顺手验一次活：401 不会在 init() 阶段暴露，只有带身份的接口才会。
   * 这里失败不退出——下一轮 oneCycle 会按「拉通知失败」记日志；但如果两份都挂，
   * 那就是真的没法干活，得让本次运行报红，避免密码失效后静默空转。 */
  try {
    await client.listReplies({ page: 1, perPage: 1 });
  } catch (e) {
    console.log('::warning::主号 Cookie 读通知失败：' + String(e.message).slice(0, 90));
    if (clients.bot === client) {
      console.error('两份 Cookie 都不可用，本次无法回复。请更新 CCW_COOKIE / CCW_COOKIE_BOT。');
      process.exit(1);
    }
  }

  /* 清脏数据模式：CCW_DELETE_IDS 传了 id 就只删不回复，删完直接退出。
   * 用来清掉历史遗留的「退回顶层的独立留言」和自己给自己发的测试留言。 */
  if (DELETE_IDS.length) {
    console.log(`删除模式：${DELETE_IDS.join(', ')}`);
    for (const id of DELETE_IDS) {
      let last = null;
      /* 不知道这条是哪个账号发的，两个都试一次 */
      for (const c of [client, BOT_COOKIE ? botClient : null].filter(Boolean)) {
        try {
          const r = await c.del(id);
          last = r;
          if (String(r && r.code) === '200') break;
        } catch (e) {
          last = { msg: e.message };
        }
      }
      console.log(`   delete ${id} -> ${JSON.stringify(last).slice(0, 120)}`);
      await sleep(2000);
    }
    process.exit(0);
  }

  const state = loadState();
  const dryRun = !AUTO;

  /* 首次运行（真实发送模式）：只认领、不发送。
   * state.json 是空的，脚本不知道你手动回过的那些评论，直接真发会重复回一遍。
   * dry-run 不走这里，这样你手动预览仍能看到将要回的内容。
   * state 非空后这段永远不触发。 */
  if (BOOTSTRAP && !dryRun && Object.keys(state.replied).length === 0) {
    const nowBoot = Date.now();
    let claimed = 0;
    /* 两份 Cookie 的通知都要认领，否则第二份账号的历史留言会被当成新留言回一遍 */
    for (const c of [client, BOT_COOKIE ? botClient : null].filter(Boolean)) {
      const list = await c.listReplies({ page: 1, perPage: 20 });
      for (const item of list) {
        const id = String(item.triggeredById || '');
        if (!id) continue;
        if (state.replied[id]) continue;
        if ((nowBoot - (item.createdAt || 0)) / 3600000 > MAX_AGE_HOURS) continue;
        state.replied[id] = { at: nowBoot, bootstrap: true };
        claimed += 1;
        const preview = String(item.comment || '').replace(/\s+/g, ' ').slice(0, 30);
        console.log(`   [认领] ${item.senderName || item.senderOid || '?'}：「${preview}」`);
      }
    }
    saveState(state);
    console.log(`首次运行：已认领 ${claimed} 条历史通知，本轮不发送。下一轮起只回新留言。`);
    process.exit(0);
  }

  let total = 0;
  let fatal = '';
  for (let i = 1; i <= CYCLES; i++) {
    try {
      total += await oneCycle(clients, state, { round: i, dryRun });
    } catch (e) {
      console.error(`第 ${i} 轮出错:`, e.message);
      // 鉴权类错误不能吞掉，否则 Actions 显示成功、失败提示也不会触发
      if (/无效的session|401|网络故障|0000003/i.test(e.message)) fatal = e.message;
    }
    saveState(state);   // 每轮存一次，崩了也不丢进度

    if (i < CYCLES) {
      const gap = Math.max(30, GAP_SEC + rand(-20, 20));
      console.log(`等待 ${gap}s 进入下一轮…`);
      await sleep(gap * 1000);
    }
  }

  console.log(`完成：本次共回复 ${total} 条，累计记录 ${Object.keys(state.replied).length} 条`);

  if (fatal) {
    // Cookie 失效是「到期维护」而不是「代码崩了」。每 30 分钟让 run 变红会刷 48 封失败邮件/天，
    // 所以同一个故障 24 小时内只报一次红的，其余静默退出（日志里仍有 warning）。
    const nowFatal = Date.now();
    const lastAuthFail = state.authFailAt || 0;
    const sinceHours = (nowFatal - lastAuthFail) / 3600000;
    state.authFailAt = nowFatal;
    saveState(state);

    if (sinceHours < AUTH_FAIL_THROTTLE_HOURS) {
      console.log(`::warning::Cookie 已失效（${fatal}），${AUTH_FAIL_THROTTLE_HOURS} 小时内已报过一次，本次静默跳过。`);
      console.log(`请重新从浏览器复制 Cookie，更新 CCW_COOKIE。上次报错在 ${Math.round(sinceHours)} 小时前。`);
      process.exit(0);
    }

    console.error('鉴权失败：' + fatal);
    console.error('这是 Cookie 失效（登录态过期）。重新从浏览器复制 Cookie，更新 CCW_COOKIE。');
    process.exit(1);
  }
})().catch((e) => {
  console.error('运行出错:', e.message);
  process.exit(1);
});
