/* 探针 v18：topicId 用 studentNumber 试读两块留言板。
 * 蔚小喵 studentNumber=285005419（commentCount 134）
 * AC小天 studentNumber=284001891（commentCount 717）
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const NUM_WEI = 285005419;
const NUM_AC = 284001891;

const out = (label, r) => {
  const b = (r && r.body) || {};
  const n = (b.data || []).length;
  console.log(label + ' => code=' + r.code + ' total=' + b.totalNum + ' 条数=' + n);
  if (n) {
    console.log('   字段: ' + Object.keys(b.data[0]).join(','));
    for (const x of b.data.slice(0, 3)) {
      console.log('   · commentId=' + (x.commentId || x.id) + ' by=' +
        ((x.commenter && x.commenter.name) || x.senderName || '?') +
        ' 「' + String(x.content || x.comments || '').replace(/\s+/g, ' ').slice(0, 26) + '」');
    }
  }
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();

  const cases = [
    ['W1 蔚小喵 topicId only', { topicId: NUM_WEI, page: 1, perPage: 10 }],
    ['W2 蔚小喵 +PROFILE', { topicId: NUM_WEI, topicType: 'PROFILE', page: 1, perPage: 10 }],
    ['W3 蔚小喵 +STUDENT', { topicId: NUM_WEI, topicType: 'STUDENT', page: 1, perPage: 10 }],
    ['A1 AC小天 topicId only', { topicId: NUM_AC, page: 1, perPage: 10 }],
    ['A2 AC小天 +PROFILE', { topicId: NUM_AC, topicType: 'PROFILE', page: 1, perPage: 10 }],
    ['A3 AC小天 +STUDENT', { topicId: NUM_AC, topicType: 'STUDENT', page: 1, perPage: 10 }]
  ];
  for (const [label, body] of cases) {
    try {
      const r = await c._signed('/comment/page?page=1&perPage=10', body, { retry: false });
      out(label, r);
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 90));
    }
  }

  console.log('v18 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
