/* ============================================================
 * state.json 合并脚本（merge-state.js）
 *
 * 为什么需要它：
 *   一轮跑 20 分钟，期间别的运行、或者我在本机用 API 改状态，都会往仓库推 commit。
 *   运行结束时本地状态是「旧版本 + 这轮新增」，直接 push 会和远端冲突，
 *   之前就是卡在这里三次 push 全失败，状态没落盘，下一轮又把同一批评论回一遍。
 *
 * 做法：
 *   把本轮跑出来的状态丢到临时文件，仓库先 reset 到远端最新，再合并两者的 replied。
 *   同一个评论 id 取并集，谁有记录就保留（不丢任何一边的进度），其余字段取较新值。
 *
 * 用法： node merge-state.js <本轮生成的 state.json> <.git 里的 state.json>
 * ============================================================ */
'use strict';

const fs = require('node:fs');

const localPath = process.argv[2];
const remotePath = process.argv[3];
if (!localPath || !remotePath) {
  console.error('用法: node merge-state.js <本轮 state> <远端 state>');
  process.exit(1);
}

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

const local = readJson(localPath);
const remote = readJson(remotePath) || { replied: {} };

if (!local || !local.replied) {
  console.error('本轮的 state.json 读不出来，放弃合并，避免覆盖远端进度');
  process.exit(1);
}

const merged = { replied: { ...(remote.replied || {}) } };
let added = 0;
for (const [id, rec] of Object.entries(local.replied || {})) {
  const old = merged.replied[id];
  if (!old) added += 1;
  merged.replied[id] = old ? { ...old, ...rec } : rec;
}
if (local.authFailAt) {
  merged.authFailAt = Math.max(Number(local.authFailAt), Number(remote.authFailAt || 0));
}

fs.writeFileSync(remotePath, JSON.stringify(merged, null, 1) + '\n');
console.log(
  `state 合并完成：远端 ${Object.keys(remote.replied || {}).length} 条 + 本轮新增 ${added} 条 ` +
  `-> 共 ${Object.keys(merged.replied).length} 条`
);
