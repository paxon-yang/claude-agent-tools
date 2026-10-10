package io.github.paxonyang.agentcard

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import android.text.TextUtils
import java.text.DateFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Date
import java.util.Locale
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * 把卡片画成一张图（和电脑上的小卡片同一套样子：深色、模型色光晕、效果格、在跑的子代理、本周额度）。
 * 桌面小组件的普通控件做不出渐变、光晕和进度格，所以整张卡片用 Canvas 画好再放上去。
 *
 * Draws the card as one bitmap, in the desktop card's style (dark, model-tinted glow, effort meter,
 * running sub-agents, weekly plan usage). Home-screen widgets can't do gradients or glows with plain views,
 * so the whole card is painted with a Canvas.
 */
object Render {
    // 颜色 / colours (same as the desktop card)
    private const val CARD = 0xF51C1C1E.toInt()
    private const val INK = 0xFFF5F5F7.toInt()
    private const val MUTED = 0x99EBEBF5.toInt()
    private const val FAINT = 0x61EBEBF5.toInt()
    private const val HAIR = 0x17FFFFFF
    private const val GREEN = 0xFF34C759.toInt()
    private const val GREEN_L = 0xFF63E28A.toInt()
    private const val RED = 0xFFFF453A.toInt()
    private const val RED_L = 0xFFFF8A80.toInt()
    private const val ORANGE = 0xFFFF9F0A.toInt()
    private const val ORANGE_L = 0xFFFFB340.toInt()
    private const val BLUE_L = 0xFF409CFF.toInt()

    private val BOLD: Typeface = Typeface.create("sans-serif", Typeface.BOLD)
    private val MEDIUM: Typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
    private val REGULAR: Typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    private val MONO: Typeface = Typeface.MONOSPACE

    /** 右下角 ↗ 的点击区域（dp）：布局里的透明按钮要和这里一样大 / the ↗ tap area in dp; the layout's overlay matches it */
    const val OPEN_W_DP = 52
    const val OPEN_H_DP = 44

    private fun alpha(c: Int, a: Float): Int = Color.argb((Color.alpha(c) * a).roundToInt(), Color.red(c), Color.green(c), Color.blue(c))

    /** 画一张 wPx × hPx 的卡片 / paint a wPx × hPx card */
    fun card(context: Context, wPx: Int, hPx: Int, density: Float): Bitmap {
        val w = max(wPx, 1)
        val h = max(hPx, 1)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        Painter(context, c, w.toFloat(), h.toFloat(), density).draw()
        return bmp
    }

    private class Painter(val ctx: Context, val c: Canvas, val W: Float, val H: Float, val d: Float) {
        val prefs = Prefs(ctx)
        val data = prefs.data()
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        val tp = TextPaint(Paint.ANTI_ALIAS_FLAG)
        fun dp(x: Float) = x * d
        fun dp(x: Int) = x * d
        val padX = dp(16)
        val right: Float get() = W - padX

        fun text(s: String, x: Float, baseline: Float, size: Float, color: Int, face: Typeface = REGULAR): Float {
            tp.typeface = face
            tp.textSize = dp(size)
            tp.color = color
            c.drawText(s, x, baseline, tp)
            return tp.measureText(s)
        }

        fun measure(s: String, size: Float, face: Typeface = REGULAR): Float {
            tp.typeface = face
            tp.textSize = dp(size)
            return tp.measureText(s)
        }

        /** 一行放不下就加省略号 / one line, ellipsised to fit */
        fun fit(s: String, maxW: Float, size: Float, face: Typeface = REGULAR): String {
            tp.typeface = face
            tp.textSize = dp(size)
            return TextUtils.ellipsize(s, tp, max(0f, maxW), TextUtils.TruncateAt.END).toString()
        }

        fun round(l: Float, t: Float, r: Float, b: Float, rad: Float, fill: Int, stroke: Int? = null) {
            val rect = RectF(l, t, r, b)
            p.shader = null
            p.style = Paint.Style.FILL
            p.color = fill
            c.drawRoundRect(rect, rad, rad, p)
            if (stroke != null) {
                p.style = Paint.Style.STROKE
                p.strokeWidth = max(1f, dp(1f))
                p.color = stroke
                c.drawRoundRect(RectF(l + 0.5f, t + 0.5f, r - 0.5f, b - 0.5f), rad, rad, p)
                p.style = Paint.Style.FILL
            }
        }

        fun dot(cx: Float, cy: Float, r: Float, color: Int) {
            p.shader = null
            p.style = Paint.Style.FILL
            p.color = color
            c.drawCircle(cx, cy, r, p)
        }

        /** 带首字母的彩色小方块 / the coloured square with the model's letter */
        fun glyph(l: Float, t: Float, size: Float, family: String?, letter: String, grey: Boolean = false) {
            val c1 = if (grey) 0xFF8E8E93.toInt() else Model.familyLight(family)
            val c2 = if (grey) 0xFF636366.toInt() else Model.familyColor(family)
            p.style = Paint.Style.FILL
            p.color = Color.WHITE  // 渐变不受上一次颜色的透明度影响 / keep the gradient at full strength
            p.shader = LinearGradient(0f, t, 0f, t + size, c1, c2, Shader.TileMode.CLAMP)
            c.drawRoundRect(RectF(l, t, l + size, t + size), size * 0.32f, size * 0.32f, p)
            p.shader = null
            tp.typeface = BOLD
            tp.textSize = size * 0.55f
            tp.color = Color.WHITE
            val tw = tp.measureText(letter)
            val fm = tp.fontMetrics
            c.drawText(letter, l + (size - tw) / 2, t + size / 2 - (fm.ascent + fm.descent) / 2, tp)
        }

        fun draw() {
            val s = data?.session
            val fam = s?.family
            val radius = dp(24)
            // 卡片底色、光晕、描边 / card, glow, hairline
            val clip = Path().apply { addRoundRect(RectF(0f, 0f, W, H), radius, radius, Path.Direction.CW) }
            c.save()
            c.clipPath(clip)
            p.color = CARD
            c.drawRect(0f, 0f, W, H, p)
            val g = Model.familyColor(fam)
            p.color = Color.WHITE  // 渐变不受上一次颜色的透明度影响 / keep the gradient at full strength
            p.shader = RadialGradient(W * 0.22f, -H * 0.15f, max(W, H) * 0.85f, intArrayOf(alpha(g, 0.42f), alpha(g, 0.12f), Color.TRANSPARENT), floatArrayOf(0f, 0.45f, 1f), Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, W, H, p)
            p.color = Color.WHITE  // 渐变不受上一次颜色的透明度影响 / keep the gradient at full strength
            p.shader = RadialGradient(W * 0.95f, -H * 0.25f, max(W, H) * 0.6f, intArrayOf(alpha(Model.familyLight(fam), 0.18f), Color.TRANSPARENT), null, Shader.TileMode.CLAMP)
            c.drawRect(0f, 0f, W, H, p)
            p.shader = null
            c.restore()
            round(0f, 0f, W, H, radius, Color.TRANSPARENT, 0x1FFFFFFF)

            if (data == null) {
                empty()
                return
            }
            val st = Model.status(s)
            var y = dp(14)

            // 第一行：项目 + 状态 / row 1: project + status
            val (stLabel, stColor, stBg) = when (st) {
                Status.RUNNING -> Triple(R.string.st_running, GREEN_L, alpha(GREEN, 0.20f))
                Status.NEEDS_YOU -> Triple(R.string.st_need, RED_L, alpha(RED, 0.24f))
                Status.BACKGROUND -> Triple(R.string.st_bg, GREEN_L, alpha(GREEN, 0.20f))
                Status.IDLE -> Triple(R.string.st_idle, MUTED, 0x14FFFFFF)
                Status.ENDED -> Triple(R.string.st_ended, MUTED, 0x14FFFFFF)
                Status.NONE -> Triple(R.string.st_none, MUTED, 0x14FFFFFF)
            }
            val pillText = ctx.getString(stLabel)
            val pillW = measure(pillText, 11f, BOLD) + dp(8 + 6 + 5 + 9)
            val pillH = dp(21)
            round(right - pillW, y, right, y + pillH, pillH / 2, stBg)
            dot(right - pillW + dp(8 + 3), y + pillH / 2, dp(3), stColor)
            text(pillText, right - pillW + dp(8 + 6 + 5), y + pillH / 2 + dp(4), 11f, stColor, BOLD)
            val others = data.others.size
            val proj = (s?.project ?: ctx.getString(R.string.app_name))
            val projMax = right - pillW - dp(10) - padX
            val extra = if (others > 0) "  +$others" else ""
            val projFit = fit(proj, projMax - measure(extra, 12f, MEDIUM), 14f, BOLD)
            val pw = text(projFit, padX, y + pillH / 2 + dp(5), 14f, INK, BOLD)
            if (extra.isNotEmpty()) text(extra, padX + pw, y + pillH / 2 + dp(5), 12f, FAINT, MEDIUM)
            y += pillH + dp(8)

            // 标题（最多两行）/ title, up to two lines
            val title = s?.task ?: ctx.getString(if (s == null) R.string.st_none else R.string.no_task)
            tp.typeface = BOLD
            tp.textSize = dp(18)
            tp.color = if (s?.task == null) FAINT else INK
            val tw = (right - padX).toInt().coerceAtLeast(1)
            val bottomH = bottomHeight()
            val roomForTitle = H - bottomH - y - dp(34)
            val lines = if (roomForTitle > dp(46)) 2 else 1
            val layout = StaticLayout.Builder.obtain(title, 0, title.length, tp, tw)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setLineSpacing(0f, 1.12f)
                .setIncludePad(false)
                .setEllipsize(TextUtils.TruncateAt.END)
                .setMaxLines(lines)
                .build()
            c.save()
            c.translate(padX, y)
            layout.draw(c)
            c.restore()
            y += layout.height + dp(9)

            // 模型行：方块 + 名字 + 效果格 + 档位 + 用时 / model row
            if (s?.model != null) {
                val gs = dp(22)
                glyph(padX, y, gs, fam, Model.glyph(fam, s.model))
                var x = padX + gs + dp(7)
                val mid = y + gs / 2 + dp(4.5f)
                x += text(s.model, x, mid, 13f, INK, BOLD) + dp(9)
                val bars = Model.effortBars(s.effort)
                if (bars > 0) {
                    val lc = Model.familyLight(fam)
                    for (i in 0 until 4) {
                        round(x, y + gs / 2 - dp(1.5f), x + dp(9), y + gs / 2 + dp(1.5f), dp(2), if (i < bars) lc else 0x29FFFFFF)
                        x += dp(11)
                    }
                    x += dp(4)
                }
                s.effort?.let { x += text(it, x, mid, 12f, MUTED) + dp(6) }
                val started = s.taskStartedAt
                if (started != null && s.taskEndedAt == null && s.active) {
                    val sec = max(0.0, nowSec() - started).toLong()
                    val t = if (sec >= 3600) "${sec / 3600}:${"%02d".format((sec % 3600) / 60)}:${"%02d".format(sec % 60)}" else "${sec / 60}:${"%02d".format(sec % 60)}"
                    x += text("· $t", x, mid, 12f, MUTED) + dp(8)
                }
                // 右边：缓存、测试的小标签，放得下才放 / on the right: cache and test tags, when they fit
                var rx = right
                for ((label, color) in tags(s).reversed()) {
                    val wv = measure(label, 11f, MEDIUM) + dp(14)
                    if (rx - wv < x) break
                    round(rx - wv, y + gs / 2 - dp(10), rx, y + gs / 2 + dp(10), dp(10), Color.TRANSPARENT, 0x24FFFFFF)
                    text(label, rx - wv + dp(7), y + gs / 2 + dp(4), 11f, color, MEDIUM)
                    rx -= wv + dp(6)
                }
                y += gs + dp(10)
            }

            // 中间：等你确认 / 在跑的 / 正在做 / 空闲 / middle: needs you, running, now, idle
            val midBottom = H - bottomH - dp(6)
            if (st == Status.NEEDS_YOU) {
                val msg = ctx.getString(R.string.need_prefix, s?.needMsg ?: "")
                tp.typeface = BOLD
                tp.textSize = dp(12)
                tp.color = RED_L
                val inner = (right - padX - dp(10 + 7 + 8 + 10)).toInt().coerceAtLeast(1)
                val maxLines = if (midBottom - y > dp(56)) 2 else 1
                val l = StaticLayout.Builder.obtain(msg, 0, msg.length, tp, inner).setMaxLines(maxLines).setEllipsize(TextUtils.TruncateAt.END).setIncludePad(false).build()
                val boxH = l.height + dp(18)
                if (y + boxH <= midBottom + dp(4)) {
                    round(padX, y, right, y + boxH, dp(12), alpha(RED, 0.16f), alpha(0xFFFF6961.toInt(), 0.35f))
                    dot(padX + dp(10 + 3.5f), y + boxH / 2, dp(3.5f), RED)
                    c.save(); c.translate(padX + dp(10 + 7 + 8), y + dp(9)); l.draw(c); c.restore()
                    y += boxH + dp(8)
                }
            } else if (s != null && s.running.isNotEmpty()) {
                // 都放得下就用两行的样子，放不下就每个一行 / two-line rows when they all fit, otherwise one line each
                val gap = dp(6)
                val n = s.running.size
                val full = y + n * dp(42) + (n - 1) * gap <= midBottom
                val rowH = if (full) dp(42) else dp(30)
                s.running.forEachIndexed { i, r ->
                    if (y + rowH > midBottom) return@forEachIndexed
                    val left = n - i - 1
                    val more = if (left > 0 && y + rowH + gap + rowH > midBottom) left else 0
                    runRow(r, y, rowH, compact = !full, more = more)
                    y += rowH + gap
                }
            } else if (s != null) {
                val line = when {
                    st == Status.RUNNING && s.now != null -> s.now
                    st == Status.IDLE && s.task != null -> ctx.getString(R.string.waiting_you)
                    else -> null
                }
                if (line != null && y + dp(34) <= midBottom) {
                    round(padX, y, right, y + dp(34), dp(11), 0x0DFFFFFF, HAIR)
                    dot(padX + dp(12), y + dp(17), dp(3.5f), if (st == Status.RUNNING) GREEN else 0x38FFFFFF)
                    val face = if (st == Status.RUNNING) MONO else REGULAR
                    val size = if (st == Status.RUNNING) 11.5f else 12f
                    text(fit(line, right - padX - dp(32), size, face), padX + dp(22), y + dp(21.5f), size, if (st == Status.RUNNING) INK else MUTED, face)
                    y += dp(34) + dp(8)
                }
            }

            bottom()
        }

        fun tags(s: Session): List<Pair<String, Int>> = Model.meta(s, nowSec()).mapNotNull {
            when (it) {
                is Meta.CacheLeft -> Pair(ctx.getString(R.string.meta_cache, it.minutes), MUTED)
                is Meta.Gate -> Pair(
                    ctx.getString(
                        when (it.result) {
                            "pass" -> R.string.gate_pass; "fail" -> R.string.gate_fail; "giveup" -> R.string.gate_giveup
                            "timeout" -> R.string.gate_timeout; else -> R.string.gate_skip
                        },
                    ),
                    if (it.result == "pass") GREEN_L else if (it.result == "fail" || it.result == "giveup") RED_L else MUTED,
                )
                else -> null
            }
        }

        fun nowSec(): Double {
            val d = data ?: return System.currentTimeMillis() / 1000.0
            return d.now + ((System.currentTimeMillis() - prefs.lastOkAt).coerceAtLeast(0)) / 1000.0
        }

        fun runRow(r: Run, top: Float, h: Float, compact: Boolean = false, more: Int = 0) {
            val isBg = r.kind == "bg"
            val lc = if (isBg) 0xFFAEAEB2.toInt() else Model.familyLight(r.family)
            round(padX, top, right, top + h, dp(12), 0x0DFFFFFF, if (isBg) HAIR else alpha(lc, 0.45f))
            // 底部一段高光，表示在跑 / a highlight along the bottom edge: it's running
            p.color = Color.WHITE  // 渐变不受上一次颜色的透明度影响 / keep the gradient at full strength
            p.shader = LinearGradient(padX + (right - padX) * 0.15f, 0f, padX + (right - padX) * 0.55f, 0f, intArrayOf(Color.TRANSPARENT, lc, Color.TRANSPARENT), null, Shader.TileMode.CLAMP)
            c.save()
            c.clipPath(Path().apply { addRoundRect(RectF(padX, top, right, top + h), dp(12), dp(12), Path.Direction.CW) })
            c.drawRect(padX, top + h - dp(2), right, top + h, p)
            c.restore()
            p.shader = null
            val gs = if (compact) dp(18) else dp(22)
            glyph(padX + dp(9), top + (h - gs) / 2, gs, r.family, if (isBg) "⚙" else Model.glyph(r.family, r.model ?: r.name), grey = isBg)
            val x = padX + dp(9) + gs + dp(9)
            var avail = right - dp(10) - x
            if (more > 0) {
                // 还有几个放不下 / how many more didn't fit
                val label = "+$more"
                val mw = measure(label, 11.5f, MEDIUM)
                text(label, right - dp(10) - mw, top + h / 2 + dp(4), 11.5f, FAINT, MEDIUM)
                avail -= mw + dp(8)
            }
            if (compact) {
                val base = top + h / 2 + dp(4.5f)
                var cx = x
                cx += text(fit(r.name, avail * 0.45f, 12.5f, MEDIUM), cx, base, 12.5f, INK, MEDIUM) + dp(6)
                r.model?.let { cx += text(fit(it, x + avail - cx, 12f, MEDIUM), cx, base, 12f, lc, MEDIUM) + dp(6) }
                r.text?.let { if (x + avail - cx > dp(30)) text(fit("· $it", x + avail - cx, 11.5f), cx, base, 11.5f, MUTED) }
                return
            }
            val name = fit(r.name, avail * 0.6f, 12.5f, MEDIUM)
            val nw = text(name, x, top + dp(17), 12.5f, INK, MEDIUM)
            r.model?.let { text(fit(it, avail - nw - dp(6), 12f, MEDIUM), x + nw + dp(6), top + dp(17), 12f, lc, MEDIUM) }
            r.text?.let { text(fit(it, avail, 11.5f), x, top + dp(33), 11.5f, MUTED) }
        }

        /** 底部（额度 + 页脚）占多高 / height of the bottom block (plan usage + footer) */
        fun bottomHeight(): Float = (if (data?.limits?.sevenDay != null) dp(30) else 0f) + dp(36) + dp(12)

        fun bottom() {
            val d = data ?: return
            var y = H - dp(12) - dp(36) - (if (d.limits?.sevenDay != null) dp(30) else 0f)
            d.limits?.sevenDay?.let { wk ->
                val pct = wk.pct.coerceIn(0.0, 100.0)
                val base = y + dp(12)
                var x = padX
                x += text(ctx.getString(R.string.q_week), x, base, 11.5f, MUTED) + dp(7)
                x += text("${pct.roundToInt()}%", x, base + dp(0.5f), 13f, INK, BOLD) + dp(8)
                d.limits?.fiveHour?.let { x += text(ctx.getString(R.string.q_5h, it.pct.roundToInt()), x, base, 11f, FAINT) }
                resetLabel(wk.resetsAt)?.let {
                    val label = ctx.getString(R.string.q_reset, it)
                    val lw = measure(label, 11f)
                    if (right - lw > x + dp(8)) text(label, right - lw, base, 11f, FAINT)
                }
                val by = y + dp(19)
                round(padX, by, right, by + dp(5), dp(3), 0x1AFFFFFF)
                val (c1, c2) = when (Model.quotaLevel(pct)) {
                    2 -> Pair(RED, RED_L)
                    1 -> Pair(ORANGE, ORANGE_L)
                    else -> Pair(GREEN, GREEN_L)
                }
                val fillR = padX + (right - padX) * (pct / 100.0).toFloat()
                if (fillR > padX + dp(2)) {
                    p.color = Color.WHITE  // 渐变不受上一次颜色的透明度影响 / keep the gradient at full strength
                    p.shader = LinearGradient(padX, 0f, fillR, 0f, c1, c2, Shader.TileMode.CLAMP)
                    c.drawRoundRect(RectF(padX, by, fillR, by + dp(5)), dp(3), dp(3), p)
                    p.shader = null
                }
                y += dp(30)
            }
            // 分隔线 + 页脚 / divider + footer
            p.color = HAIR
            c.drawRect(padX, y + dp(4), right, y + dp(4) + max(1f, dp(1f)), p)
            val base = y + dp(25)
            val err = prefs.lastError.isNotBlank()
            val live = prefs.liveUntil > System.currentTimeMillis()
            var x = padX
            if (err) {
                dot(x + dp(3), base - dp(4), dp(3), RED)
                x += dp(10)
                x += text(ctx.getString(R.string.stale, clock(prefs.lastOkAt)), x, base, 11f, RED_L) + dp(10)
            } else {
                dot(x + dp(3), base - dp(4), dp(3), if (live) GREEN else FAINT)
                x += dp(10)
                x += text(if (live) ctx.getString(R.string.live) else clock(prefs.lastOkAt), x, base, 11f, FAINT) + dp(10)
            }
            val t = d.totals
            t.cost?.let { cost ->
                x += text(ctx.getString(R.string.foot_hours, t.hours), x, base, 11.5f, MUTED) + dp(4)
                x += text(Model.money(cost), x, base, 11.5f, INK, BOLD) + dp(8)
                val saved = t.saved
                if (saved != null && saved >= 0.01 && x < right - dp(OPEN_W_DP + 50)) {
                    text(fit(ctx.getString(R.string.foot_saved, (saved * 100).roundToInt()), right - dp(OPEN_W_DP - 10) - x, 11.5f, MEDIUM), x, base, 11.5f, GREEN_L, MEDIUM)
                }
            }
            // ↗
            p.color = BLUE_L
            p.style = Paint.Style.STROKE
            p.strokeWidth = dp(1.8f)
            p.strokeCap = Paint.Cap.ROUND
            val ax = right - dp(5)
            val ay = base - dp(9)
            c.drawLine(ax - dp(8), ay + dp(8), ax, ay, p)
            c.drawLine(ax - dp(5.5f), ay, ax, ay, p)
            c.drawLine(ax, ay, ax, ay + dp(5.5f), p)
            p.style = Paint.Style.FILL
        }

        fun clock(ms: Long): String = if (ms <= 0) "—" else DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ms))

        fun resetLabel(iso: String?): String? {
            if (iso.isNullOrBlank()) return null
            return try {
                val at = Instant.parse(iso).atZone(ZoneId.systemDefault())
                val hm = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at.toInstant().toEpochMilli()))
                if (at.toInstant().toEpochMilli() - System.currentTimeMillis() < 20 * 3600_000L) hm
                else at.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.getDefault()) + " " + hm
            } catch (e: Exception) {
                null
            }
        }

        /** 还没设置、或者一直没连上 / not set up yet, or never reached */
        fun empty() {
            val gs = dp(30)
            glyph(padX, dp(16), gs, "opus", "A")
            text(ctx.getString(R.string.app_name), padX + gs + dp(10), dp(16) + gs / 2 + dp(5), 15f, INK, BOLD)
            val msg = CardWidget.errorText(ctx, if (prefs.url.isBlank()) Fail.NO_URL.name else prefs.lastError.ifBlank { Fail.NETWORK.name })
            tp.typeface = BOLD
            tp.textSize = dp(17)
            tp.color = INK
            val l = StaticLayout.Builder.obtain(msg, 0, msg.length, tp, (right - padX).toInt().coerceAtLeast(1)).setMaxLines(2).setEllipsize(TextUtils.TruncateAt.END).build()
            c.save(); c.translate(padX, dp(16) + gs + dp(14)); l.draw(c); c.restore()
            if (prefs.url.isNotBlank()) {
                text(fit(prefs.url.removePrefix("https://").removePrefix("http://"), right - padX, 11.5f), padX, H - dp(18), 11.5f, FAINT)
            }
        }
    }

    /** 小组件实际大小（dp）→ 画多大的图（px），太大就按比例缩小，免得超过系统限制 / widget size → bitmap size, scaled down if huge */
    fun pixels(wDp: Float, hDp: Float, density: Float, maxPixels: Int = 900_000): Triple<Int, Int, Float> {
        var scale = density
        val area = wDp * hDp * scale * scale
        if (area > maxPixels) scale *= kotlin.math.sqrt(maxPixels / area)
        return Triple(max(1, (wDp * scale).roundToInt()), max(1, (hDp * scale).roundToInt()), scale)
    }
}
