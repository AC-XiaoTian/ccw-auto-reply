/* 探针 v11：锁定 /comment/page 的话题参数名。
 * v10 已知：body 传 {topic:{...}} 会报「话题ID不能为空」，说明字段是 topic + 某个 Id 名。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const OWNER = '6a2804f986bbc77f84e60cdf';   // AC小天 留言板
const SELF = '69f8547586bbc77f84e5a574';    // 蔚小喵 自己
const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 400));
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();

  const variants = [
    ['A {topicId}', { topicId: OWNER, page: 1, perPage: 20 }],
    ['B {topicOid}', { topicOid: OWNER, page: 1, perPage: 20 }],
    ['C {id}', { id: OWNER, page: 1, perPage: 20 }],
    ['D {topicId,topicType}', { topicId: OWNER, topicType: 'PROFILE', page: 1, perPage: 20 }],
    ['E {topic:{topicId}}', { topic: { topicId: OWNER, subjectType: 'PROFILE' }, page: 1, perPage: 20 }],
    ['F {commentTopicId}', { commentTopicId: OWNER, page: 1, perPage: 20 }]
  ];

  for (const [label, body] of variants) {
    try {
      const r = await c._signed('/comment/page?page=1&perPage=20', body, { retry: false });
      show(label, r);
      const arr = (r.body && (r.body.data || r.body.list)) || [];
      if (Array.isArray(arr) && arr.length) {
        console.log('   ✔ 拿到 ' + arr.length + ' 条，首条字段: ' + Object.keys(arr[0]).join(','));
        for (const n of arr.slice(0, 3)) {
          console.log('   · id=' + (n.id || n.commentId) + ' by=' + (n.senderName || n.studentInfo && n.studentInfo.nickname || '?') +
            ' 时间=' + (n.createdAt ? new Date(n.createdAt).toISOString().slice(5, 16) : '-') +
            ' 「' + String(n.content || n.comment || '').replace(/\s+/g, ' ').slice(0, 30) + '」');
        }
        break;
      }
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 120));
    }
  }

  console.log('v11 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
