/* 探针 v17：把 profile 的完整 JSON 与 featured 评论首条完整打出来。
 * 目标：找出「留言板话题 id」（/comment/page 认数字 topicId）。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const WEI = '6a2804f986bbc77f84e60cdf';   // 蔚小喵
const AC = '69f8547586bbc77f84e5a574';    // AC小天

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();

  for (const [label, oid] of [['蔚小喵', WEI], ['AC小天', AC]]) {
    try {
      const r = await c._signed('/students/profile', { studentOid: oid }, { retry: false });
      console.log('PROFILE_' + label + '=' + JSON.stringify(r.body));
    } catch (e) {
      console.log('PROFILE_' + label + ' 失败: ' + e.message.slice(0, 90));
    }
  }

  try {
    const r = await c._signed('/featured_comment/component/list', { subjectOid: AC }, { retry: false });
    const arr = (r.body && r.body.data) || r.body || [];
    console.log('FEATURED_COUNT=' + (Array.isArray(arr) ? arr.length : 'notarray'));
    if (Array.isArray(arr) && arr[0]) console.log('FEATURED_ONE=' + JSON.stringify(arr[0]).slice(0, 1200));
  } catch (e) {
    console.log('featured 失败: ' + e.message.slice(0, 90));
  }

  console.log('v17 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
