/* 探针：确认「作品点赞」「评论置顶」的真实接口与参数。
 * 只在 GitHub Actions 里跑（要用 secret 里的 CCW_COOKIE），跑完就把结论抄进代码。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s;
  try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 320));
};

(async () => {
  const c = new CCWClient({ cookie: process.env.CCW_COOKIE });
  await c.init();
  console.log('签名就绪');

  const notices = await c.listReplies({ perPage: 20 });
  console.log('通知条数: ' + notices.length);
  if (!notices.length) { console.log('没有通知，无法取样'); return; }

  const n = notices.find((x) => x.subjectType === 'CREATION') || notices[0];
  console.log('样例字段: ' + Object.keys(n).join(','));
  console.log('subjectOid=' + n.subjectOid + ' subjectType=' + n.subjectType +
    ' triggeredById=' + n.triggeredById + ' outline=' + (n.subjectOutline || n.subjectTitle || '(空)'));

  // 1) 作品详情：确认用 oid 能取到作品，以及返回里有没有 commentWeight 之类的字段
  show('A /creation/detail {oid}', await c._signed('/creation/detail', { oid: n.subjectOid }, { retry: true }));

  // 2) 点赞状态
  show('B /creation/like/detail', await c._signed('/creation/like/detail', { creationOid: n.subjectOid }, { retry: true }));

  // 3) 点赞（对象是他自己的作品，安全）
  show('C /creation_stats/like {creationOid}', await c._signed('/creation_stats/like', { creationOid: n.subjectOid }));
  show('C2 /creation_stats/like {playingCreationOid,creationOid}', await c._signed('/creation_stats/like', {
    creationOid: n.subjectOid, playingCreationOid: n.subjectOid
  }));
  show('C3 点赞后状态 /creation/like/detail', await c._signed('/creation/like/detail', { creationOid: n.subjectOid }, { retry: true }));

  // 4) 置顶候选：逐个试，看哪个不是「接口不存在」
  const pinPaths = [
    '/comment/update_weight',
    '/study-community/comment/update_weight',
    '/comment/weight/update',
    '/comment/top',
    '/comment/pin',
    '/comment/sticky',
    '/study-community/comment/top'
  ];
  for (const p of pinPaths) {
    show('D ' + p, await c._signed(p, { id: Number(n.triggeredById), weight: 1 }));
  }

  // 5) 置顶权限位：能拿到就说明账号有权限，再看它要求什么
  show('E allow_update_weight {id}', await c._signed('/study-community/comment/allow_update_weight', { id: Number(n.triggeredById) }, { retry: true }));

  // 6) 评论点赞（给对方那条评论点赞，用来确认 unlike/undo 的字段）
  show('F /comment/like_record/create', await c._signed('/comment/like_record/create', { commentId: Number(n.triggeredById) }));
  show('F2 /comment/like_record/create {id}', await c._signed('/comment/like_record/create', { id: Number(n.triggeredById) }));

  console.log('探测结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
