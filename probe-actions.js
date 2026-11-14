/* 探针 v5：目标只剩置顶。
 * A) 试出「读某作品评论列表」的正确参数（拿到自己作品下的评论 id）
 * B) 用那条评论 id 试置顶：/study-community/comment/top、/featured_comment/*
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 220));
};
const brief = (o) => JSON.stringify(o || {}).slice(0, 220);

(async () => {
  const c = new CCWClient({ cookie: process.env.CCW_COOKIE || '' });
  await c.init();

  const OWN = '6adbfdc01f19651c11fb2cc8'; // CCW CSP的防护拦截（我自己的作品）
  const REL = '6aef0ddfc3024779b57fa522';

  // A) 评论列表参数候选
  const listTries = [
    ['{topicOid}', { topicOid: OWN, page: 1, perPage: 10 }],
    ['{topicId}', { topicId: OWN, page: 1, perPage: 10 }],
    ['{id}', { id: OWN, page: 1, perPage: 10 }],
    ['{subjectId}', { subjectId: OWN, page: 1, perPage: 10 }],
    ['{oid}', { oid: OWN, page: 1, perPage: 10 }],
    ['{creationOid}', { creationOid: OWN, page: 1, perPage: 10 }],
    ['{creationReleaseOid}', { creationReleaseOid: REL, page: 1, perPage: 10 }]
  ];
  for (const [label, p] of listTries) show('comment/page ' + label, await c._signed('/comment/page', p, { retry: true }));

  // 换成 /featured_comment/page 看能不能读到（这个是前端确实在用的）
  show('featured_comment/page {creationOid}', await c._signed('/featured_comment/page?page=1&perPage=10', { creationOid: OWN, page: 1, perPage: 10 }, { retry: true }));

  // B) 置顶候选（先用刚才通知里那条别人的评论 id 试路径是否存在，再看自己作品）
  const OTHER_CID = 10289497;
  for (const p of ['/featured_comment/create', '/featured_comment/add', '/featured_comment/upsert', '/featured_comment/delete']) {
    show('B ' + p, await c._signed(p, { id: OTHER_CID, commentId: OTHER_CID, creationOid: OWN }));
  }

  // C) 自己作品下的置顶（若 A 步拿到 id 才有意义；这里固定再试一次以确认权限位）
  show('C top {id:' + OTHER_CID + ',creationOid}', await c._signed('/study-community/comment/top', { id: OTHER_CID, creationOid: OWN }));

  console.log('v5 探测结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
