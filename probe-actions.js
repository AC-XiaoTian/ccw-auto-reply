/* 探针 v2：敲定点赞的 action 取值、评论置顶的参数。
 * 结论会抄进 ccw-node-client.js。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s;
  try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 250));
};

(async () => {
  const c = new CCWClient({ cookie: process.env.CCW_COOKIE });
  await c.init();
  const notices = await c.listReplies({ perPage: 20 });
  const n = notices.find((x) => x.subjectType === 'CREATION') || notices[0];
  const oid = n.subjectOid;
  const cid = Number(n.triggeredById);
  console.log('目标作品 ' + oid + ' | 评论 ' + cid + ' | 通知 url=' + n.url);
  console.log('creationInfo: ' + JSON.stringify(n.creationInfo || {}).slice(0, 200));

  // ---- 点赞：试 action 的各种取值 ----
  for (const action of ['LIKE', 'like', '1', 1, true]) {
    show('like action=' + JSON.stringify(action), await c._signed('/creation_stats/like', { creationOid: oid, action }));
  }
  show('like detail {creationOid}', await c._signed('/creation/like/detail', { creationOid: oid }, { retry: true }));

  // ---- 评论置顶：路径已存在，试不同参数组合 ----
  const pinTries = [
    ['{id,subjectOid}', { id: cid, subjectOid: oid }],
    ['{id,creationOid}', { id: cid, creationOid: oid }],
    ['{commentId,subjectOid}', { commentId: cid, subjectOid: oid }],
    ['{id,subjectOid,weight:1}', { id: cid, subjectOid: oid, weight: 1 }],
    ['{id,subjectOid,top:true}', { id: cid, subjectOid: oid, top: true }],
    ['{id,subjectOid,subjectType:CREATION}', { id: cid, subjectOid: oid, subjectType: 'CREATION' }],
    ['{id,subjectOid,action:TOP}', { id: cid, subjectOid: oid, action: 'TOP' }]
  ];
  for (const [label, body] of pinTries) {
    show('top ' + label, await c._signed('/study-community/comment/top', body));
  }
  show('allow_update_weight {id,subjectOid}', await c._signed('/study-community/comment/allow_update_weight', { id: cid, subjectOid: oid }, { retry: true }));

  // ---- 评论点赞的删除（取消赞）确认字段 ----
  show('comment unlike', await c._signed('/comment/like_record/delete', { commentId: cid }));

  console.log('v2 探测结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
