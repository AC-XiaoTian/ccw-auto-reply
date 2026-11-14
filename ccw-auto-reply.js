/* ============================================================
 * 自动回复脚本（ccw-auto-reply.js）
 * 依赖：同目录 ccw-node-client.js（零第三方依赖）
 *
 * 流程：
 *   拉「回复我的」通知(/notification/page COMMENT_TO_ME)
 *   -> 按 ID 去重（state.json）
 *   -> AI 生成一句回复（AI 不可用时退回兜底文案）
 *   -> /comment/create 发回（作品评论带 replyToId，留言板不带）
 *   -> 记录状态
 *
 * 环境变量：
 *   CCW_COOKIE         必填，"token=...; cookie-user-id=..."
 *   CCW_AUTO_REPLY     '1' 才真发；否则 dry-run 只打印
 *   AI_API_URL         OpenAI 兼容的 chat/completions 地址；留空则不用 AI
 *   AI_API_KEY         AI 的 key
 *   AI_MODEL           模型名，默认 gpt-4o-mini
 *   AI_SYSTEM_PROMPT   可选，自定义回复风格
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
const AUTO = process.env.CCW_AUTO_REPLY === '1';
const MAX_AGE_HOURS = Number(process.env.CCW_MAX_AGE_HOURS || '24');
const MAX_PER_RUN = Number(process.env.CCW_MAX_PER_RUN || '3');
const CYCLES = Number(process.env.CCW_CYCLES || '2');
const GAP_SEC = Number(process.env.CCW_CYCLE_GAP_SEC || '150');
const STATE_FILE = process.env.CCW_STATE_FILE || './state.json';

const AI_API_URL = (process.env.AI_API_URL || '').trim();
const AI_API_KEY = (process.env.AI_API_KEY || '').trim();
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o-mini';
const AI_SYSTEM_PROMPT = process.env.AI_SYSTEM_PROMPT ||
  '你在共创世界的评论区回复网友。中文、口语化、不超过 40 字，' +
  '不要自称 AI，不要提模型，不要长篇大论，直接给一句自然得体的回应。';

const FALLBACK_TEXT = process.env.CCW_REPLY_TEXT || '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

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

/* 把对方评论内容交给 AI，返回一句回复；任何异常都返回空串，交给兜底文案 */
async function aiReply(notice) {
  if (!AI_API_URL || !AI_API_KEY) return '';
  const incoming = String(notice.comment || '').slice(0, 500);
  if (!incoming) return '';

  const body = {
    model: AI_MODEL,
    messages: [
      { role: 'system', content: AI_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `有人在我的${notice.subjectType === 'PROFILE' ? '主页留言板' : '作品评论区'}留言：「${incoming}」。\n请回一句。`
      }
    ],
    temperature: 0.7,
    max_tokens: 120
  };

  try {
    const res = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) {
      console.log('   AI 接口返回', res.status, (await res.text()).slice(0, 200));
      return '';
    }
    const data = await res.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content) || '';
    return clean(text);
  } catch (e) {
    console.log('   AI 调用失败:', e.message);
    return '';
  }
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

async function oneCycle(client, state, opts) {
  const { round, dryRun } = opts;
  const list = await client.listReplies({ page: 1, perPage: 20 });
  console.log(`[第 ${round} 轮] 通知 ${list.length} 条 | 模式: ${dryRun ? 'dry-run' : '真实发送'}`);

  const now = Date.now();
  const todo = list
    .filter((n) => {
      const id = String(n.triggeredById || '');
      if (!id) return false;
      if (state.replied[id]) return false;
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
    const aiText = await aiReply(n);
    const body = pickText(n, aiText);

    if (dryRun) {
      console.log(`   [dry-run] ${who}：「${preview}」-> 「${body}」`);
      continue;
    }

    const r = await client.replyToNotice(n, body);
    if (r && String(r.code) === '200') {
      state.replied[String(n.triggeredById)] = { at: now, id: r.body && r.body.id };
      sent += 1;
      console.log(`   已回复 ${who} -> commentId ${r.body && r.body.id}`);
    } else {
      console.log(`   失败 ${who}: ${JSON.stringify(r).slice(0, 200)}`);
    }
    // 间隔随机化，别用固定节奏
    await sleep(rand(2500, 6000));
  }
  return sent;
}

(async () => {
  if (!COOKIE) {
    console.error('缺少环境变量 CCW_COOKIE（形如 token=...; cookie-user-id=...）');
    process.exit(1);
  }

  const client = new CCWClient({ cookie: COOKIE });

  try {
    await client.init();
  } catch (e) {
    console.error('签名初始化失败:', e.message);
    console.error('最常见原因：Cookie 里的 token 过期（有效期约 16 天）。' +
      '注意这时接口可能返回「网络故障 0000003」，那不是网络问题，是缺登录态。');
    process.exit(1);
  }
  console.log('签名就绪');

  const state = loadState();
  const dryRun = !AUTO;

  let total = 0;
  let fatal = '';
  for (let i = 1; i <= CYCLES; i++) {
    try {
      total += await oneCycle(client, state, { round: i, dryRun });
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
    console.error('鉴权失败：' + fatal);
    console.error('这是 Cookie 失效（token 有效期约 16 天）。重新从浏览器复制 Cookie，更新 CCW_COOKIE。');
    process.exit(1);
  }
})().catch((e) => {
  console.error('运行出错:', e.message);
  process.exit(1);
});
