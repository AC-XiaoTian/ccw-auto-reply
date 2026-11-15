/* 探针 v10：找「按留言板拉评论列表」的读接口。
 * 目的：让蔚小喵用自己的 Cookie 读 AC小天 留言板（oid 6a2804...）上的评论，
 *      不依赖 AC小天 的通知，也不需要 AC小天 的 token。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const OWNER = '6a2804f986bbc77f84e60cdf';   // AC小天 留言板
const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 300));
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  const oid = (/cookie-user-id=([0-9a-zA-Z]+)/.exec(cookie) || [])[1] || '?';
  console.log('使用 Cookie 身份 oid=' + oid);
  await c.init();
  console.log('签名就绪');

  // 0) 先确认这份 Cookie 读自己的通知能通（对照组）
  try {
    const l = await c.listReplies({ page: 1, perPage: 3 });
    console.log('对照：读自己通知 -> ' + l.length + ' 条');
  } catch (e) {
    console.log('对照：读自己通知失败 -> ' + e.message.slice(0, 80));
  }

  const q = '?page=1&perPage=20';
  const tries = [
    ['A /comment/reply?page {topic}', `/comment/reply${q}`, { topic: { subjectOid: OWNER, subjectType: 'PROFILE' }, page: 1, perPage: 20 }],
    ['B /comment/reply?page {subjectOid}', `/comment/reply${q}`, { subjectOid: OWNER, subjectType: 'PROFILE', page: 1, perPage: 20 }],
    ['C /comment/reply {topicOid}', '/comment/reply', { topicOid: OWNER, topicType: 'PROFILE', page: 1, perPage: 20 }],
    ['D /comment/reply {oid,type}', '/comment/reply', { oid: OWNER, type: 'PROFILE', page: 1, perPage: 20 }],
    ['E /comment/page {topic}', `/comment/page${q}`, { topic: { subjectOid: OWNER, subjectType: 'PROFILE' }, page: 1, perPage: 20 }],
    ['F /comment {topic}', '/comment', { topic: { subjectOid: OWNER, subjectType: 'PROFILE' }, page: 1, perPage: 20 }]
  ];

  for (const [label, path, body] of tries) {
    try {
      const r = await c._signed(path, body, { retry: false });
      show(label, r);
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 120));
    }
  }

  console.log('v10 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
