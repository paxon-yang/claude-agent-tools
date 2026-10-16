'use strict';
// 官方价格的几条规则（Claude API 价格表，2026-10 核对）/ rules from the official price table (checked Oct 2026)
// - 读缓存不是统一的输入价 × 0.1：Opus 5.5 和 Sonnet 5.5 是 × 0.05，Fable 5.1 是 × 0.025，Haiku 5.5 是 × 0.1
//   cache reads are not a flat 0.1× of input: Opus/Sonnet 5.5 are 0.05×, Fable 5.1 0.025×, Haiku 5.5 0.1×
// - 写缓存：5 分钟 × 1.25，1 小时 × 2 / cache writes: 1.25× (5 min), 2× (1 h)
// - Haiku 5.5 提示超过 10 万 token 的请求，所有单价 × 5（整条请求按高价算）
//   Haiku 5.5 requests whose prompt is over 100K tokens pay 5× on every rate (the whole request)
const CACHE_READ_RATIO = { haiku: 0.1, sonnet: 0.05, opus: 0.05, fable: 0.025, mythos: 0.025 };
const LONG_PROMPT = { haiku: { above: 100000, mult: 5 } };

/** 一个模型的单价（每百万 token）；p = 配置里的 {in, out, cacheRead?, cacheWrite?, longAbove?, longMult?} */
function rates(fam, p) {
  if (!p || p.in == null || p.out == null) return null;
  const pin = Number(p.in), pout = Number(p.out);
  const ratio = CACHE_READ_RATIO[fam] != null ? CACHE_READ_RATIO[fam] : 0.1;
  const long = LONG_PROMPT[fam] || {};
  return {
    in: pin, out: pout,
    cr: p.cacheRead != null ? Number(p.cacheRead) : pin * ratio,
    cw: p.cacheWrite != null ? Number(p.cacheWrite) : pin * 1.25,
    longAbove: p.longAbove != null ? Number(p.longAbove) : (long.above || 0),
    longMult: p.longMult != null ? Number(p.longMult) : (long.mult || 1),
  };
}

/** 一条请求的花费（美元）；u = {in, out, cr, cw}。长提示加价按这条请求自己的提示长度算 */
function requestCost(u, r) {
  if (!r) return null;
  const prompt = (u.in || 0) + (u.cr || 0) + (u.cw || 0);
  const k = r.longAbove > 0 && prompt > r.longAbove ? r.longMult : 1;
  return k * ((u.in || 0) * r.in + (u.out || 0) * r.out + (u.cr || 0) * r.cr + (u.cw || 0) * r.cw) / 1e6;
}

module.exports = { rates, requestCost, CACHE_READ_RATIO, LONG_PROMPT };
