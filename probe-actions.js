/* 探针 v3：
 * 1) 用 cookie 里的 cookie-user-id 认领「自己」，只挑自己作品下的通知测置顶
 * 2) 敲定点赞：{oid, action} 的取值，以及取消赞的取值
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s;
  try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 220));
};

(async () => {
  const cookie = process.env.CCW_COOKIE || '';
  const mine = (cookie.match(/cookie-user-id=([^;]+)/) || [])[1] || '';
  console.log('我的 user-id: ' + mine);

  const c = new CCWClient({ cookie });
  await c.init();
  const notices = await c.listReplies({ perPage: 20 });

  // 找出「我自己作品」下的通知
  const own = [];
  for (const n of notices) {
    if (n.subjectType !== 'CREATION' || !n.subjectOid) continue;
    const d = await c._signed('/creation/detail', { oid: n.subjectOid }, { retry: true });
    const owner = d && d.body && d.body.student && d.body.student.oid;
    const isMine = owner === mine;
    console.log(`作品 ${n.subjectOid} owner=${owner} 是我的=${isMine} 评论=${n.triggeredById}`);
    if (isMine) own.push(n);
    if (own.length >= 2) break;
  }

  if (own.length) {
    const n = own[0];
    const cid = Number(n.triggeredById);
    const oid = n.subjectOid;
    console.log('用自己作品测置顶: 作品 ' + oid + ' 评论 ' + cid);
    show('top {id}', await c._signed('/study-community/comment/top', { id: cid }));
    show('top {id,subjectOid}', await c._signed('/study-community/comment/top', { id: cid, subjectOid: oid }));
    show('top {id,subjectOid,top:true}', await c._signed('/study-community/comment/top', { id: cid, subjectOid: oid, top: true }));
    show('allow_update_weight {id}', await c._signed('/study-community/comment/allow_update_weight', { id: cid }, { retry: true }));
  } else {
    console.log('没找到自己作品下的通知，跳过置顶测试');
  }

  // ---- 点赞：{oid, action} ----
  const target = (own[0] && own[0].subjectOid) || notices[0].subjectOid;
  console.log('点赞目标作品: ' + target);
  for (const action of ['LIKE', 'like', 'ADD', 'CANCEL', 'UNLIKE', 'cancel']) {
    show('like {oid,' + action + '}', await c._signed('/creation_stats/like', { oid: target, action }));
  }
  show('like detail', await c._signed('/creation/like/detail', { oid: target }, { retry: true }));

  console.log('v3 探测结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
