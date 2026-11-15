/* 探针 v12：/comment/page 的 topicId 已被接受，缺的是配套参数。
 * v11 结果：{topicId} 或 {topicId,topicType:'PROFILE'} 都报「请求无效, 参数错误」，
 *          说明 topicId 认了，但还有别的字段不对（多半是 perPage 上限或 subjectType 取值）。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const OWNER = '6a2804f986bbc77f84e60cdf';
const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 320));
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();
  console.log('身份 oid=' + ((/cookie-user-id=([0-9a-zA-Z]+)/.exec(cookie) || [])[1] || '?'));

  const variants = [
    ['A1 {topicId,page,perPage:10}', { topicId: OWNER, page: 1, perPage: 10 }],
    ['A2 {topicId,page,perPage:5}', { topicId: OWNER, page: 1, perPage: 5 }],
    ['A3 {topicId} 只传它', { topicId: OWNER }],
    ['A4 {topicId,subjectType:PROFILE}', { topicId: OWNER, subjectType: 'PROFILE', page: 1, perPage: 10 }],
    ['A5 {topicId,topicType:PROFILE_LEAVE_WOWRDS}', { topicId: OWNER, topicType: 'PROFILE_LEAVE_WOWRDS', page: 1, perPage: 10 }],
    ['A6 {topicId,type:PROFILE}', { topicId: OWNER, type: 'PROFILE', page: 1, perPage: 10 }],
    ['A7 {topicId,pageNum,pageSize}', { topicId: OWNER, pageNum: 1, pageSize: 10 }],
    ['A8 query 带 topicId', { page: 1, perPage: 10 }]
  ];

  for (const [label, body] of variants) {
    const path = label.startsWith('A8')
      ? '/comment/page?page=1&perPage=10&topicId=' + OWNER
      : '/comment/page?page=1&perPage=10';
    try {
      const r = await c._signed(path, body, { retry: false });
      show(label, r);
      const arr = (r.body && (r.body.data || r.body.list || (r.body.page && r.body.page.data))) || [];
      if (Array.isArray(arr) && arr.length) {
        console.log('   ✔ 拿到 ' + arr.length + ' 条');
        console.log('   字段: ' + Object.keys(arr[0]).join(','));
        for (const n of arr.slice(0, 3)) {
          console.log('   · id=' + (n.id || n.commentId) + ' by=' +
            (n.senderName || (n.studentInfo && n.studentInfo.nickname) || '?') +
            ' 「' + String(n.content || n.comment || '').replace(/\s+/g, ' ').slice(0, 30) + '」');
        }
        break;
      }
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 100));
    }
  }

  console.log('v12 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
