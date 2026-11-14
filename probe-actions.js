/* 探针 v4：
 * 1) 确认我是谁（拿自己的 studentOid）
 * 2) 列我自己的作品，拿一个自己的作品 oid
 * 3) 点赞：试 {creationOid, oid, action} 组合，看 oid 到底指哪个
 * 4) 置顶：在自己作品的评论区找一条评论 id，再试 /study-community/comment/top
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s;
  try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 240));
};
const brief = (o) => JSON.stringify(o || {}).slice(0, 300);

(async () => {
  const cookie = process.env.CCW_COOKIE || '';
  const uid = (cookie.match(/cookie-user-id=([^;]+)/) || [])[1] || '';
  const c = new CCWClient({ cookie });
  await c.init();

  // 1) 我是谁
  show('student/current', await c._signed('/student/current', {}, { retry: true }));
  show('member/detail', await c._signed('/study-community/member/detail', { oid: uid }, { retry: true }));

  // 2) 我自己的作品
  const own = await c._signed('/creation/own/page', { page: 1, perPage: 10 }, { retry: true });
  console.log('own/page: ' + brief(own));
  let oid = '';
  const list = (own && own.body && (own.body.data || own.body.list)) || [];
  if (list.length) {
    oid = list[0].oid || list[0].creationOid || '';
    console.log('取到自己作品: ' + oid + ' title=' + (list[0].title || ''));
  }

  if (!oid) {
    console.log('拿不到自己的作品 oid，后续测试中止');
    return;
  }

  const d = await c._signed('/creation/detail', { oid }, { retry: true });
  const body = (d && d.body) || {};
  const relOid = (body.creationRelease && (body.creationRelease.oid || body.creationRelease.releaseOid)) || '';
  console.log('作品 oid=' + (body.oid || oid) + ' | creationRelease.oid=' + relOid + ' | student.oid=' + ((body.student || {}).oid || ''));

  // 3) 点赞组合
  const combos = [
    ['{creationOid,action:LIKE}', { creationOid: oid, action: 'LIKE' }],
    ['{creationOid,oid:rel,action:LIKE}', { creationOid: oid, oid: relOid, action: 'LIKE' }],
    ['{oid:creation,action:LIKE}', { oid, action: 'LIKE' }],
    ['{creationOid,creationReleaseOid,action:LIKE}', { creationOid: oid, creationReleaseOid: relOid, action: 'LIKE' }]
  ];
  for (const [label, payload] of combos) show('like ' + label, await c._signed('/creation_stats/like', payload));

  // 4) 自己作品下的评论 → 置顶
  const cm = await c._signed('/comment/page', { subjectOid: oid, subjectType: 'CREATION', page: 1, perPage: 10 }, { retry: true });
  console.log('comment/page: ' + brief(cm));
  const comments = (cm && cm.body && (cm.body.data || cm.body.list)) || [];
  if (comments.length) {
    const firstId = comments[0].id || comments[0].commentId;
    console.log('自己作品下的评论 id=' + firstId + ' by=' + ((comments[0].student || {}).nickname || ''));
    show('top {id}', await c._signed('/study-community/comment/top', { id: Number(firstId) }));
    show('allow_update_weight {id}', await c._signed('/study-community/comment/allow_update_weight', { id: Number(firstId) }, { retry: true }));
  } else {
    console.log('没取到评论列表，置顶仍未测');
  }

  console.log('v4 探测结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
