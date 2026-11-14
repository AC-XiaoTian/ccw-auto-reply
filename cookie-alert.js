/* ============================================================
 * cookie-alert.js
 * 目的：Cookie（登录态）失效时，不要静默停掉，而是开一个 GitHub Issue 通知人。
 *
 * 为什么需要它：
 *   CCW 的 token 是服务端会话凭证，浏览器 cookie 层面给的是 180 天
 *   （前端 o.a.set("token", e, {expires:180})，js-cookie 单位是天），
 *   但服务端真正认多久没有公开数据，可能远短于 180 天。
 *   一旦失效，自动回复会一声不响地停掉 —— 这比报错更糟，因为没人知道它停了。
 *
 * 判断依据：state.json 里的 authFailAt（ccw-auto-reply.js 在鉴权失败时写入）
 *   - 没有该字段 → Cookie 正常，什么都不做
 *   - 该时间在 3 小时内 → 判定为本次失效，开 Issue（已有未关闭的同名 Issue 则不重复开）
 *   - 更早 → 是旧记录，跳过
 * ============================================================ */
'use strict';

const fs = require('node:fs');

const STATE = 'state.json';
const FRESH_MS = 3 * 60 * 60 * 1000; // authFailAt 在三小时内才算「这次失效」
const TITLE = 'CCW Cookie 已失效，需要更新 CCW_COOKIE';

function readAuthFailAt() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE, 'utf8'));
    return Number(s.authFailAt || 0);
  } catch {
    return 0; // 文件不存在/损坏：不当成失效，避免误报
  }
}

async function ghFetch(path, init) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const url = `https://api.github.com/repos/${repo}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ccw-cookie-alert',
      ...(init && init.headers),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

(async () => {
  const failAt = readAuthFailAt();
  if (!failAt) {
    console.log('Cookie 未报过失效，无需提醒');
    return;
  }

  const ageHours = (Date.now() - failAt) / 3600000;
  if (ageHours > 3) {
    console.log(`authFailAt 是 ${ageHours.toFixed(1)} 小时前的旧记录，不重复提醒`);
    return;
  }

  if (!(process.env.GH_TOKEN || process.env.GITHUB_TOKEN) || !process.env.GITHUB_REPOSITORY) {
    console.log('缺少 GH_TOKEN / GITHUB_REPOSITORY，跳过开 Issue（本地调试时会看到这条）');
    return;
  }

  // 已经开过就不重复开，避免每轮刷一个 Issue
  const open = await ghFetch('/issues?state=open&per_page=30&sort=created&direction=desc');
  if (open.status === 200 && Array.isArray(open.data)) {
    if (open.data.some((i) => (i.title || '').trim() === TITLE)) {
      console.log('已有未关闭的同名 Issue，跳过');
      return;
    }
  }

  const body = [
    '自动检测到 CCW 的登录态（Cookie）已经失效，自动回复**已停止发送**。',
    '',
    '### 怎么修（两分钟）',
    '1. 用浏览器打开 `www.ccw.site` 并确认是登录状态（同一账号）',
    '2. 按 F12 → Application/应用 → Cookies → 选 `www.ccw.site`',
    '3. 复制 `token`（40 位）和 `cookie-user-id`（24 位），拼成：',
    '   `token=xxx; cookie-user-id=yyy`',
    '4. 仓库 Settings → Secrets and variables → Actions → 更新 `CCW_COOKIE`',
    '5. 回本 Issue 关掉它；下一轮运行会自动恢复回复',
    '',
    '### 说明',
    '- 前端写入这份 cookie 时给的是 180 天有效期，但服务端真正认多久没有公开数据，本次实测到的失效时间是：'
      + new Date(failAt).toISOString(),
    '- 这个 Issue 只在「刚失效的那 3 小时内」创建一次，不会每轮刷屏。',
  ].join('\n');

  const created = await ghFetch('/issues', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: TITLE, body, labels: ['cookie'] }),
  });

  if (created.status === 201) {
    console.log('已创建提醒 Issue: ' + created.data.html_url);
  } else if (created.status === 422) {
    // label 不存在会导致 422，退一步不带 label 再试
    const retry = await ghFetch('/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: TITLE, body }),
    });
    console.log(retry.status === 201 ? '已创建提醒 Issue（无 label）: ' + retry.data.html_url : '创建失败: ' + retry.status);
  } else {
    console.log('创建失败: ' + created.status + ' ' + JSON.stringify(created.data).slice(0, 200));
  }
})();
