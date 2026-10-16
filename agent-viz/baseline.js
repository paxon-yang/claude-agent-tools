'use strict';
// 对照组的缓存账："全程用一个模型"时，主会话不会因为换模型而重写缓存。
// Baseline cache accounting: on "one model all along", the main session never re-writes its cache because of a model switch.
//
// 实际记录里，换模型后的第一次请求要把整段上下文按"写缓存"价重新写一遍；回到原模型时，中间新增的部分也会再写一次。
// 如果对照组照搬这些写缓存的 token，就等于让"全程 Opus"也为换模型付钱，省下的比例会被算高。
// 这里按对照组的视角重算：上一条主会话请求的上下文还在缓存里（没过期、没压缩），这一条只需要写新增的部分，其余按读缓存算。
// In the real log the first request after a switch re-writes the whole context at the cache-write price, and switching back
// writes the part added in between again. Copying those writes into the baseline would make "all on Opus" pay for switches
// too and inflate the savings. Here the baseline re-prices them: if the previous main-session request is still cached (not
// expired, not compacted), only the newly added tokens are written; the rest counts as cache reads.

const DEFAULT_TTL_SEC = 3600; // 按 1 小时缓存算：对照组的读缓存更多、更便宜，省下的比例更保守 / 1 h: more baseline reads, a more conservative saving

const ctxOf = u => (u.in || 0) + (u.cr || 0) + (u.cw || 0);

/**
 * u: 这条请求的实际用量 {in, out, cr, cw}；prev: 同一主会话上一条请求 {ts, ctx}；ts: 这条的时间（毫秒）
 * 返回对照组该算的用量（没变化时原样返回同一个对象）
 */
function baselineUsage(u, prev, ts, ttlSec = DEFAULT_TTL_SEC) {
  if (!prev || !(u.cw > 0)) return u;
  const gap = ts - prev.ts;
  if (!(gap >= 0 && gap <= ttlSec * 1000)) return u;
  const ctx = ctxOf(u);
  if (ctx < prev.ctx) return u; // 上下文变短（压缩过），前缀不同了，确实要重写 / compacted: the prefix changed, a rewrite is real
  const fresh = ctx - prev.ctx; // 新增的部分（这一轮的新消息、工具结果）/ what was added since the previous request
  const cw = Math.min(u.cw, fresh);
  if (cw === u.cw) return u;
  return Object.assign({}, u, { cr: (u.cr || 0) + (u.cw - cw), cw });
}

/** 给一组主会话记录（同一会话、按时间排好）逐条算出对照组用量，写到 r.base / fills r.base along one session's main records */
function fillBaselines(recs, ttlSec = DEFAULT_TTL_SEC) {
  let prev = null;
  for (const r of recs) {
    r.base = baselineUsage(r, prev, r.ts, ttlSec);
    prev = { ts: r.ts, ctx: ctxOf(r) };
  }
  return recs;
}

module.exports = { baselineUsage, fillBaselines, ctxOf, DEFAULT_TTL_SEC };
