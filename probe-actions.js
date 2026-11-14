/* 探针 v6（最后一次）：用自己作品下真实的评论 id 试置顶与权重写入。
 * 目标评论 10236501 来自 /featured_comment/page（作品 6adbfdc01f19651c11fb2cc8）
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 220));
};

(async () => {
  const c = new CCWClient({ cookie: process.env.CCW_COOKIE || '' });
  await c.init();

  const OWN = '6adbfdc01f19651c11fb2cc8';
  const CID = 10236501;

  show('A top {id}', await c._signed('/study-community/comment/top', { id: CID }));
  show('B top {id,subjectOid}', await c._signed('/study-community/comment/top', { id: CID, subjectOid: OWN }));
  show('C allow_weight {id}', await c._signed('/study-community/comment/allow_update_weight', { id: CID }, { retry: true }));
  show('D allow_weight {id,subjectOid}', await c._signed('/study-community/comment/allow_update_weight', { id: CID, subjectOid: OWN }, { retry: true }));

  const weightTries = [
    ['/study-community/comment/weight', { id: CID }],
    ['/comment/weight', { id: CID }],
    ['/study-community/comment/updateWeight', { id: CID, weight: 1 }],
    ['/study-community/comment/set_weight', { id: CID, weight: 1 }],
    ['/study-community/comment/top {id,weight:1,top:true}', { id: CID, weight: 1, top: true }]
  ];
  for (const [p, body] of weightTries) show('E ' + p, await c._signed(p, body));

  // 确认这条评论确实在我自己作品下
  show('F featured/page 再读一次（看 commentId 是否还在首位）',
    await c._signed('/featured_comment/page?page=1&perPage=5', { creationOid: OWN, page: 1, perPage: 5 }, { retry: true }));

  console.log('v6 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
