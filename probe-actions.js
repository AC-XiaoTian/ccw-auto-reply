/* 探针 v16：把 /students/profile 的完整字段打出来，找「留言板话题 id」。
 * 已知：/comment/page 认数字 topicId，但 284001891 返回空，说明话题 id 另有其值。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const WEI = '6a2804f986bbc77f84e60cdf';   // 蔚小喵（AI自动回复）
const AC = '69f8547586bbc77f84e5a574';    // AC小天（现在在回复的那个号）

const dump = (label, obj) => {
  console.log(label + ' 完整字段长度 ' + JSON.stringify(obj || {}).length);
  const keys = Object.keys(obj || {}).filter((k) => /id|topic|comment|leave|board|num/i.test(k));
  for (const k of keys) {
    const v = obj[k];
    if (typeof v !== 'object' || v === null) console.log('   ' + k + ' = ' + String(v).slice(0, 60));
  }
  console.log('   全量: ' + JSON.stringify(obj).slice(0, 900));
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();

  for (const [label, oid] of [['蔚小喵', WEI], ['AC小天', AC]]) {
    try {
      const r = await c._signed('/students/profile', { studentOid: oid }, { retry: false });
      dump(label + ' profile(' + oid + ')', r.body || {});
    } catch (e) {
      console.log(label + ' profile 失败: ' + e.message.slice(0, 90));
    }
  }

  console.log('--- featured_comment/component/list ---');
  const fc = [
    ['F1 {subjectOid 蔚小喵}', { subjectOid: WEI }],
    ['F2 {creationOid 蔚小喵}', { creationOid: WEI }],
    ['F3 {topicId 284001891}', { topicId: 284001891 }],
    ['F4 {studentOid 蔚小喵}', { studentOid: WEI }]
  ];
  for (const [label, body] of fc) {
    try {
      const r = await c._signed('/featured_comment/component/list', body, { retry: false });
      console.log(label + ' => ' + JSON.stringify(r).slice(0, 200));
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 80));
    }
  }

  console.log('v16 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
