/* 探针 v7：验证新加的客户端方法本身（签名链路 + 字段名）
 *   likeCreation / likeComment / unlikeComment / pinComment
 * 只在自己作品与自己作品下的一条评论上做，点赞后立刻取消，不留痕。
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

  const OWN = '6adbfdc01f19651c11fb2cc8';   // 我自己的作品
  const CID = 10236501;                    // 该作品下的一条评论（来自 featured_comment/page）

  show('client.likeCreation(自己作品)', await c.likeCreation(OWN));
  show('client.likeCreation(非法 oid)', await c.likeCreation('123'));

  show('client.likeComment', await c.likeComment(CID));
  show('client.unlikeComment', await c.unlikeComment(CID));

  show('client.pinComment（预期被拒）', await c.pinComment(CID));

  console.log('v7 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
