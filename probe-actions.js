/* 探针 v13：topicId 传 24 位 oid 报「参数错误」，怀疑它要的是数字话题 id。
 * 先把一条通知的完整 JSON 打出来，看清里层有没有 topicId / commentId / subjectId 之类；
 * 再用 topicType 数字枚举试几种组合。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const OWNER = '6a2804f986bbc77f84e60cdf';
const show = (label, r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  console.log(label + ' => ' + (s || '').slice(0, 260));
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();

  // 1) 一条通知的完整结构
  try {
    const raw = await c._signed('/notification/page?page=1&perPage=2', { notifyGroup: 'COMMENT_TO_ME' }, { retry: false });
    const list = (raw.body && (raw.body.data || raw.body.list)) || [];
    console.log('通知条数 ' + list.length);
    if (list[0]) {
      const one = JSON.stringify(list[0], null, 1);
      console.log('第一条完整结构长度 ' + one.length);
      console.log(one.slice(0, 1800));
    }
  } catch (e) {
    console.log('读通知失败: ' + e.message.slice(0, 100));
  }

  // 2) topicType 数字枚举
  const variants = [
    ['B1 {topicId,topicType:1}', { topicId: OWNER, topicType: 1, page: 1, perPage: 10 }],
    ['B2 {topicId,topicType:2}', { topicId: OWNER, topicType: 2, page: 1, perPage: 10 }],
    ['B3 {topicId,topicType:0}', { topicId: OWNER, topicType: 0, page: 1, perPage: 10 }],
    ['B4 {topicId,topicType:"1"}', { topicId: OWNER, topicType: '1', page: 1, perPage: 10 }]
  ];
  for (const [label, body] of variants) {
    try {
      const r = await c._signed('/comment/page?page=1&perPage=10', body, { retry: false });
      show(label, r);
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 100));
    }
  }

  console.log('v13 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
