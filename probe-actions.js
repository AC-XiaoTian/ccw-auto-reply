/* 探针 v14：
 * 1) 查两个账号的真实昵称（member/detail），搞清「谁在回复、显示成什么名字」；
 * 2) /comment/page 的 topicId 到底要什么类型（数字话题 id？还是 24 位 oid？）；
 * 3) 试 /students/profile 能不能顺带拿到留言板内容。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const A = '6a2804f986bbc77f84e60cdf';   // CCW_COOKIE 那份（日志里叫 AC小天，但 401）
const B = '69f8547586bbc77f84e5a574';   // CCW_COOKIE_BOT 那份（活着，正在发）
const C = '69a2c97b86bbc77f84e4d176';   // 通知里的 subject_oid（笛莎）

const brief = (r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  return (s || '').slice(0, 220);
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();

  console.log('--- 1) 账号昵称 ---');
  for (const oid of [A, B, C]) {
    try {
      const r = await c._signed('/study-community/member/detail', { oid }, { retry: false });
      const b = r.body && (r.body.data || r.body);
      console.log('oid=' + oid + ' -> name=' + (b && (b.nickname || b.name)) +
        ' 粉丝=' + (b && b.followerCount) + ' 作品=' + (b && b.creationCount));
    } catch (e) {
      console.log('oid=' + oid + ' 查询失败: ' + e.message.slice(0, 80));
    }
  }

  console.log('--- 2) /students/profile ---');
  try {
    const r = await c._signed('/students/profile', { oid: A }, { retry: false });
    console.log(brief(r));
  } catch (e) {
    console.log('抛错: ' + e.message.slice(0, 90));
  }

  console.log('--- 3) /comment/page 类型试探 ---');
  const cases = [
    ['C1 topicId=数字 10299130', { topicId: 10299130, page: 1, perPage: 10 }],
    ['C2 topicId=数字 10299130 + topicType 1', { topicId: 10299130, topicType: 1, page: 1, perPage: 10 }],
    ['C3 topicId=笛莎 oid', { topicId: C, page: 1, perPage: 10 }],
    ['C4 空 body', {}],
    ['C5 topicId + subjectOid', { topicId: A, subjectOid: A, page: 1, perPage: 10 }],
    ['C6 topicId + subjectType 数字 3', { topicId: A, subjectType: 3, page: 1, perPage: 10 }]
  ];
  for (const [label, body] of cases) {
    try {
      const r = await c._signed('/comment/page?page=1&perPage=10', body, { retry: false });
      console.log(label + ' => ' + brief(r));
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 90));
    }
  }

  console.log('v14 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
