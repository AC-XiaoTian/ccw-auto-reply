/* 探针 v9：
 * 1) 通知里到底有没有「怎么给你充电」那条（判断二级回复会不会发通知）
 * 2) 试其它 notifyGroup 取值，看有没有专门的「回复我」分组
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 200));
};

(async () => {
  const c = new CCWClient({ cookie: process.env.CCW_COOKIE || '' });
  await c.init();

  // 1) 当前 COMMENT_TO_ME 全量（两条页都拉，避免漏）
  const all = [];
  for (const page of [1, 2]) {
    const r = await c._signed('/notification/page?page=' + page + '&perPage=20',
      { notifyGroup: 'COMMENT_TO_ME', page, perPage: 20 }, { retry: true });
    const arr = (r.body && (r.body.data || r.body.list)) || [];
    all.push(...arr);
  }
  console.log('COMMENT_TO_ME 共 ' + all.length + ' 条');
  const hit = all.filter((n) => String(n.comment || '').includes('充电'));
  console.log('含「充电」的条数: ' + hit.length);
  for (const n of hit) {
    console.log('  命中 commentId=' + n.triggeredById + ' 类型=' + n.subjectType + ' by=' + n.senderName +
      ' 时间=' + new Date(n.createdAt || 0).toISOString().slice(11, 16) + 'Z');
  }
  // 顺带把最新 5 条的时间打出来，看通知延迟
  for (const n of all.slice(0, 5)) {
    console.log('  最新 commentId=' + n.triggeredById + ' by=' + n.senderName +
      ' 「' + String(n.comment || '').replace(/\s+/g, ' ').slice(0, 24) + '」 ' +
      new Date(n.createdAt || 0).toISOString().slice(11, 16) + 'Z');
  }

  // 2) 其它分组
  for (const g of ['REPLY_TO_ME', 'REPLY_COMMENT_TO_ME', 'SUB_COMMENT_TO_ME', 'MENTION_TO_ME', 'ALL']) {
    const r = await c._signed('/notification/page?page=1&perPage=20',
      { notifyGroup: g, page: 1, perPage: 20 }, { retry: true });
    const arr = (r.body && (r.body.data || r.body.list)) || [];
    console.log('分组 ' + g + ' -> ' + arr.length + ' 条 ' + (arr.length ? '' : String(r.msg || '').slice(0, 40)));
    const h = arr.filter((n) => String(n.comment || '').includes('充电'));
    if (h.length) console.log('   !! 该分组里有「充电」: commentId=' + h[0].triggeredById);
  }

  console.log('v9 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
