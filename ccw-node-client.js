/* ============================================================
 * CCW Node 客户端（ccw-node-client.js）
 * 零第三方依赖，只用 Node 内置 crypto / fetch
 *
 * 实测结论（2026-11-15 本机验证）：
 *   1. TLS 指纹不校验 —— Node fetch 直连可通
 *   2. Origin / Referer 不校验 —— 带上即可，不带也未必拦
 *   3. 唯一硬门槛是 Cookie 里的 token（HttpOnly，但可从 CDP/DevTools 拿到）
 *   4. health/check 不带 Cookie 时返回「网络故障 0000003」，带上就正常
 *
 * 已跑通的完整闭环：
 *   /notification/page (notifyGroup=COMMENT_TO_ME)  读通知
 *   /comment/create                                发评论 / 发回复
 *   /study-community/comment/delete                删评论
 * ============================================================ */
'use strict';

const crypto = require('node:crypto');

const HOST = 'https://community-web.ccw.site';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class CCWClient {
  /**
   * @param {object} opts
   * @param {string} opts.cookie  形如 "token=xxx; cookie-user-id=yyy"
   * @param {string} [opts.userAgent]
   * @param {number} [opts.keyTTL] 签名密钥缓存时长(ms)，默认 60000
   */
  constructor(opts) {
    if (!opts || !opts.cookie) throw new Error('缺少 cookie（形如 token=...; cookie-user-id=...）');
    this.cookie = opts.cookie.trim().replace(/;$/, '');
    this.ua = opts.userAgent || DEFAULT_UA;
    this.keyTTL = opts.keyTTL || 60000;
    this._key = null;
    this._offset = 0;
    this._keyAt = 0;
  }

  /* ---------- 底层请求 ---------- */

  async _send(path, payloadObj, useSign) {
    const payload = payloadObj === null ? null : JSON.stringify(payloadObj);
    const headers = {
      'Content-Type': 'application/json;charset=UTF-8',
      'Origin': 'https://www.ccw.site',
      'Referer': 'https://www.ccw.site/',
      'User-Agent': this.ua,
      'Cookie': this.cookie,
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    };
    if (useSign) {
      const ts = String(Date.now() - this._offset);
      headers['a'] = crypto.createHmac('md5', this._key).update('ccw' + payload + ts).digest('hex');
      headers['b'] = ts;
    }
    const res = await fetch(HOST + path, { method: 'POST', headers, body: payload });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch (e) {
      throw new Error('返回非 JSON (HTTP ' + res.status + '): ' + text.slice(0, 200));
    }
    return json;
  }

  /* 取签名密钥 + 校准服务器时间。
   * 密钥来自 health/check 的 traceId：每项取 traceId[parseInt(首字符,16)+1]，
   * 8 个字符拼起来再整体反转。
   */
  async init(force) {
    if (!force && this._key && Date.now() - this._keyAt < this.keyTTL) return this;
    const h = await this._send('/health/check', null, false);
    if (!h || !Array.isArray(h.body)) {
      throw new Error('health/check 失败：' + JSON.stringify(h).slice(0, 200) +
        '（多半是 cookie 无效或 token 过期）');
    }
    this._key = h.body.map(s => {
      const t = s && s.traceId;
      if (!t) return '';
      return t[parseInt(t[0], 16) + 1] || '';
    }).reverse().join('');
    const d = await this._send('/base/dateTime', {}, false);
    this._offset = (d && typeof d.body === 'number' ? d.body : Date.now()) - Date.now();
    this._keyAt = Date.now();
    return this;
  }

  /* 签名请求。读操作原地重试一次（刷新密钥），写操作绝不自动重试，避免重复发评论。 */
  async _signed(path, bodyObj, { retry = false } = {}) {
    await this.init();
    const r = await this._send(path, bodyObj, true);
    if (r && r.code === '200') return r;
    if (retry) {
      await this.init(true);
      return this._send(path, bodyObj, true);
    }
    return r;
  }

  /* ---------- 业务 API ---------- */

  /* 读“回复我的”通知，返回 data 数组。每条的 triggeredById 就是可回复的评论 id */
  async listReplies({ page = 1, perPage = 20 } = {}) {
    const r = await this._signed(
      '/notification/page?page=' + page + '&perPage=' + perPage,
      { notifyGroup: 'COMMENT_TO_ME', page, perPage },
      { retry: true }
    );
    if (r.code !== '200') throw new Error('拉通知失败：' + JSON.stringify(r).slice(0, 300));
    return (r.body && (r.body.data || r.body.list)) || [];
  }

  /* 发顶层评论 */
  async post({ subjectOid, subjectType = 'CREATION', outline = '', content }) {
    return this._signed('/comment/create', {
      content: String(content),
      topic: { subjectOid: String(subjectOid), subjectType, outline: String(outline) }
    });
  }

  /* 回复某条评论。注意字段是 replyToId，不是 toCommentId，也不是 parentId */
  async reply({ subjectOid, subjectType = 'CREATION', outline = '', commentId, content }) {
    return this._signed('/comment/create', {
      content: String(content),
      replyToId: Number(commentId),
      topic: { subjectOid: String(subjectOid), subjectType, outline: String(outline) }
    });
  }

  /* 删除自己发的评论。字段是 id，不是 commentId */
  async del(commentId) {
    return this._signed('/study-community/comment/delete', { id: Number(commentId) });
  }

  /* ---------- 点赞 / 置顶（2026-11-15 实测口径） ---------- */

  /* 给作品点赞。字段是 oid + action，缺一个都不行：
   *   {oid}            -> oid不能为空
   *   {creationOid}    -> action不能为空
   *   {oid, action}    -> 成功，返回 {body: 点赞数, code:"200"}
   * action 只认 "LIKE"（"ADD"/"CANCEL"/"UNLIKE" 都报 action不能为空）。
   * oid 必须是作品本体 oid（列表里的 oid），传 creationRelease.oid 会报「创意作品不存在」。 */
  async likeCreation(oid) {
    if (!/^[0-9a-f]{24}$/i.test(String(oid || ''))) {
      return { code: '0000001', msg: '本地校验失败：oid 不是 24 位十六进制' };
    }
    return this._signed('/creation_stats/like', { oid: String(oid), action: 'LIKE' });
  }

  /* 给评论点赞。字段是 commentId（传 id 会报「评论ID不能为空」） */
  async likeComment(commentId) {
    return this._signed('/comment/like_record/create', { commentId: Number(commentId) });
  }

  /* 取消评论点赞 */
  async unlikeComment(commentId) {
    return this._signed('/comment/like_record/delete', { commentId: Number(commentId) });
  }

  /* 尝试把评论置顶。
   * 实测（2026-11-15）：即使评论就在自己作品下、且是官方精选里那条，
   * 也一律返回「作品仅允许作者操作(4001073X01)」，allow_update_weight 恒为 false。
   * 说明 CCW 的评论置顶/精选是官方权限。保留这个方法只为以后放开时能直接用，
   * 现在调用必然失败，调用方要按「失败即跳过」处理，不要重试。 */
  async pinComment(commentId) {
    return this._signed('/study-community/comment/top', { id: Number(commentId) });
  }

  /* 直接吃一条通知条目并回复它 */
  async replyToNotice(notice, content) {
    if (!notice) throw new Error('notice 为空');
    const type = notice.subjectType || 'CREATION';
    // topic.outline 接口要求非空（"主体概览不能为空"）。留言板通知里 subjectOutline
    // 有时为空，此时依次退到作品标题、对方昵称，最后兜一个固定词，避免整条 400。
    const outline = String(
      notice.subjectOutline || notice.subjectTitle || notice.senderName || notice.senderOid || '留言板'
    );
    if (type === 'PROFILE') {
      // 留言板也想挂到原留言下面，所以同样带 replyToId 试一次；
      // 服务端若不认（parentId 为空、退化成顶层新留言），由调用方负责删掉那条脏数据。
      return this.reply({
        subjectOid: notice.subjectOid,
        subjectType: 'PROFILE',
        outline,
        commentId: notice.triggeredById,
        content
      });
    }
    return this.reply({
      subjectOid: notice.subjectOid,
      subjectType: type,
      outline,
      commentId: notice.triggeredById,
      content
    });
  }
}

module.exports = { CCWClient, HOST };
