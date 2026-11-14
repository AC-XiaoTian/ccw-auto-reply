/* 探针 v8：确认用户发来的 285005419 是什么。
 * - 是评论 id？还是作品 id（老的数字型）？
 * - 顺便列出最近通知里的真实评论 id，方便对照。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 260));
};

(async () => {
  const c = new CCWClient({ cookie: process.env.CCW_COOKIE || '' });
  await c.init();

  const X = 285005419;

  show('1 /comment/detail {id}', await c._signed('/comment/detail', { id: X }, { retry: true }));
  show('2 /study-community/comment/detail {id}', await c._signed('/study-community/comment/detail', { id: X }, { retry: true }));
  show('3 /creation/detail {oid:数字}', await c._signed('/creation/detail', { oid: String(X) }, { retry: true }));
  show('4 /creation/detail {id:数字}', await c._signed('/creation/detail', { id: X }, { retry: true }));

  // 最近通知里真实的评论 id（triggeredById）+ 作品 oid
  const list = await c.listReplies({ page: 1, perPage: 20 });
  console.log('通知条数 ' + list.length);
  for (const n of list.slice(0, 20)) {
    const preview = String(n.comment || '').replace(/\s+/g, ' ').slice(0, 28);
    console.log(`  commentId=${n.triggeredById} 类型=${n.subjectType} 作品=${n.subjectOid} by=${n.senderName || '?'} 「${preview}」`);
  }

  console.log('v8 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
