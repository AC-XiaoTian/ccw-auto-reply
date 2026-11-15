/* 探针 v15：/comment/page 已经能用（topicId 必须是数字）。
 * 头像 URL 里的数字就是账号数字 id：69f854...（现在在回复的那个号）= 284001891。
 * 这轮要拿到三件事：
 *   1. 用 topicId=284001891 能不能真读出留言板评论（字段结构是什么）；
 *   2. AC小天 主号（6a2804...）的数字 id 是多少（换个参数名再查 profile）；
 *   3. 顺手确认这个「数字 id = 留言板 topicId」的推断对第二个号也成立。
 */
'use strict';

const { CCWClient } = require('./ccw-node-client');

const A = '6a2804f986bbc77f84e60cdf';   // 主号
const B = '69f8547586bbc77f84e5a574';   // 正在回复的号（数字 id 284001891）
const B_NUM = 284001891;

const brief = (r) => {
  let s; try { s = JSON.stringify(r); } catch { s = String(r); }
  return (s || '').slice(0, 200);
};

(async () => {
  const cookie = (process.env.CCW_COOKIE_BOT || '').trim() || (process.env.CCW_COOKIE || '').trim();
  const c = new CCWClient({ cookie });
  await c.init();

  console.log('--- 1) 读 284001891 的留言板（应是在回复那个号自己的板）---');
  try {
    const r = await c._signed('/comment/page?page=1&perPage=10', { topicId: B_NUM, page: 1, perPage: 10 }, { retry: false });
    const b = r.body || {};
    console.log('code=' + r.code + ' totalNum=' + b.totalNum + ' 返回条数=' + (b.data || []).length);
    if ((b.data || []).length) {
      console.log('字段: ' + Object.keys(b.data[0]).join(','));
      for (const n of b.data.slice(0, 3)) {
        console.log('  · id=' + n.id + ' 话题=' + n.topicId + ' 父=' + (n.parentId || '-') +
          ' by=' + ((n.senderInfo && n.senderInfo.name) || n.senderName || '?') +
          ' 「' + String(n.content || '').replace(/\s+/g, ' ').slice(0, 28) + '」');
      }
    }
  } catch (e) {
    console.log('读板失败: ' + e.message.slice(0, 90));
  }

  console.log('--- 2) 解析 AC小天 主号的数字 id ---');
  const probes = [
    ['/students/profile body studentOid', '/students/profile', { studentOid: A }],
    ['/students/profile body userId', '/students/profile', { userId: A }],
    ['/students/profile?oid= query', '/students/profile?oid=' + A, {}],
    ['/students/profile?studentOid= query', '/students/profile?studentOid=' + A, {}]
  ];
  for (const [label, path, body] of probes) {
    try {
      const r = await c._signed(path, body, { retry: false });
      const b = r.body || {};
      const av = String(b.avatar || '');
      const num = (/\/avatar\/(\d+)\//.exec(av) || [])[1] || '-';
      console.log(label + ' => oid=' + (b.oid || '-') + ' 昵称=' + (b.nickname || b.name || '-') +
        ' 数字id=' + num + ' 评论数=' + (b.commentCount || '-'));
    } catch (e) {
      console.log(label + ' => 抛错: ' + e.message.slice(0, 80));
    }
  }

  console.log('v15 结束');
})().catch((e) => { console.error('探测出错:', e.message); process.exit(1); });
