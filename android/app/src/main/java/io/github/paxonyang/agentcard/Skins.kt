package io.github.paxonyang.agentcard

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * 皮肤：卡片内容下面一层淡淡的图案，上面盖一层蒙版。和看板的 public/skins.js 画同样的图形。
 * Skins: a faint pattern under the card's content with a scrim on top; the same shapes as the board's public/skins.js.
 */
object Skins {
    data class Def(val id: String, val zh: String, val en: String)

    val LIST = listOf(
        Def("none", "默认", "Default"),
        Def("clay", "陶土", "Clay"),
        Def("contour", "等高线", "Contour"),
        Def("terminal", "终端", "Terminal"),
        Def("dunes", "沙丘", "Dunes"),
        Def("aurora", "极光", "Aurora"),
        Def("night", "星野", "Night sky"),
    )
    const val FOLLOW = "follow"
    fun valid(id: String?) = id != null && LIST.any { it.id == id }

    /** 手机上选的皮肤；"跟随电脑"时用看板发来的 / the phone's choice; "follow" uses the board's */
    fun current(prefs: Prefs, d: WidgetData?): String {
        val mine = prefs.skin
        val id = if (mine == FOLLOW) d?.skin else mine
        return if (valid(id)) id!! else "none"
    }

    fun name(context: Context, id: String): String {
        val zh = context.resources.configuration.locales[0].language == "zh"
        val d = LIST.firstOrNull { it.id == id } ?: LIST[0]
        return if (zh) d.zh else d.en
    }

    private const val CLAY = 0xFFD97757.toInt()
    private const val SAND = 0xFFE8B98A.toInt()
    private const val SAND2 = 0xFFF2D3AE.toInt()
    private const val CLAY2 = 0xFFDE9A70.toInt()
    private const val VIOLET = 0xFFA64BD6.toInt()
    private const val SKY = 0xFF409CFF.toInt()

    /** 和 skins.js 一样的随机数（mulberry32），星星和颗粒的位置两边一致 / same generator as skins.js */
    internal class Rng(seed: Int) {
        private var a = seed
        fun next(): Double {
            a += 0x6D2B79F5
            var t = (a xor (a ushr 15)) * (1 or a)
            t = (t + ((t xor (t ushr 7)) * (61 or t))) xor t
            return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL).toDouble() / 4294967296.0
        }
    }

    private fun withAlpha(c: Int, a: Double) = Color.argb((a.coerceIn(0.0, 1.0) * 255).roundToInt(), Color.red(c), Color.green(c), Color.blue(c))

    fun isDark(context: Context) =
        (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    /**
     * 画一张皮肤图（圆角已经裁好）。尺寸用 dp；返回 null 表示不用皮肤。
     * Draws a skin with rounded corners already clipped. Sizes in dp; null means no skin.
     */
    fun draw(context: Context, id: String, wDp: Float, hDp: Float, radiusDp: Float = 22f, dark: Boolean = isDark(context), scaleCap: Float = 2f): Bitmap? {
        if (id == "none" || !valid(id)) return null
        val w = wDp.coerceIn(40f, 900f)
        val h = hDp.coerceIn(40f, 900f)
        val k = min(context.resources.displayMetrics.density, scaleCap)
        val bmp = Bitmap.createBitmap((w * k).roundToInt().coerceAtLeast(1), (h * k).roundToInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(k, k)
        val clip = Path().apply { addRoundRect(RectF(0f, 0f, w, h), radiusDp, radiusDp, Path.Direction.CW) }
        c.clipPath(clip)
        shapes(c, id, w.toDouble(), h.toDouble(), dark)
        // 蒙版：左上（字多）厚，右下（图案集中）薄 / scrim: heavy top-left where the text is, light bottom-right
        val surface = context.getColor(R.color.c_surface)
        val (a0, a1) = if (dark) 0.68 to 0.12 else 0.8 to 0.2
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        p.shader = LinearGradient(0f, 0f, w, h,
            intArrayOf(withAlpha(surface, a0), withAlpha(surface, (a0 + a1) / 2), withAlpha(surface, a1)),
            floatArrayOf(0f, 0.55f, 1f), Shader.TileMode.CLAMP)
        c.drawRect(0f, 0f, w, h, p)
        return bmp
    }

    private fun shapes(c: Canvas, id: String, w: Double, h: Double, dark: Boolean) {
        val r = hypot(w, h)
        val s = min(w, h)
        val ink = if (dark) Color.WHITE else 0xFF3D2B22.toInt()
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        fun blob(x: Double, y: Double, rad: Double, color: Int, a: Double) {
            p.reset(); p.isAntiAlias = true
            p.shader = RadialGradient(x.toFloat(), y.toFloat(), rad.toFloat(), intArrayOf(withAlpha(color, a), withAlpha(color, 0.0)), null, Shader.TileMode.CLAMP)
            c.drawCircle(x.toFloat(), y.toFloat(), rad.toFloat(), p)
        }
        fun dot(x: Double, y: Double, rad: Double, color: Int, a: Double) {
            p.reset(); p.isAntiAlias = true; p.color = withAlpha(color, a)
            c.drawCircle(x.toFloat(), y.toFloat(), rad.toFloat(), p)
        }
        fun line(pts: List<Pair<Double, Double>>, color: Int, a: Double, width: Double, cap: Boolean = false) {
            p.reset(); p.isAntiAlias = true; p.style = Paint.Style.STROKE; p.strokeWidth = width.toFloat(); p.color = withAlpha(color, a)
            if (cap) { p.strokeCap = Paint.Cap.ROUND; p.strokeJoin = Paint.Join.ROUND }
            val path = Path()
            pts.forEachIndexed { i, (x, y) -> if (i == 0) path.moveTo(x.toFloat(), y.toFloat()) else path.lineTo(x.toFloat(), y.toFloat()) }
            c.drawPath(path, p)
        }
        when (id) {
            "clay" -> {
                blob(0.95 * w, 1.05 * h, 0.75 * r, CLAY, 0.6)
                blob(0.04 * w, -0.06 * h, 0.45 * r, SAND, 0.4)
                val g = Rng(11)
                val n = (w * h / 90).roundToInt()
                repeat(n) { dot(g.next() * w, g.next() * h, 0.6, ink, 0.05 + g.next() * 0.08) }
            }
            "contour" -> {
                val cx = 0.88 * w
                val cy = 0.92 * h
                blob(cx, cy, 0.42 * r, CLAY, 0.22)
                for (i in 0 until 13) {
                    val base = (0.06 + i * 0.07) * r
                    val pts = (0..96).map { kk ->
                        val th = kk / 96.0 * PI * 2
                        val rr = base * (1 + 0.1 * sin(3 * th + i * 0.45) + 0.05 * sin(5 * th + 1.3 + i * 0.2))
                        (cx + rr * cos(th)) to (cy + rr * sin(th) * 0.82)
                    }
                    line(pts, CLAY, max(0.12, 0.6 - i * 0.035), if (i % 4 == 0) 1.4 else 0.9)
                }
            }
            "terminal" -> {
                val gap = 16.0
                var y = gap / 2
                while (y < h) {
                    var x = gap / 2
                    while (x < w) {
                        val fade = min(1.0, max(0.12, 1.15 - hypot(w - x, h - y) / r * 1.3))
                        dot(x, y, 0.9, ink, (if (dark) 0.22 else 0.18) * fade)
                        x += gap
                    }
                    y += gap
                }
                val u = min(0.17 * s, 64.0)
                val x0 = w - 2.5 * u - 16
                val y0 = h - 1.25 * u - 14
                blob(w - 1.2 * u - 16, h - 0.6 * u - 14, 2.4 * u, CLAY, 0.25)
                line(listOf(x0 to y0, (x0 + 0.62 * u) to (y0 + 0.5 * u), x0 to (y0 + u)), CLAY, 0.7, 0.12 * u, cap = true)
                p.reset(); p.isAntiAlias = true; p.color = withAlpha(CLAY, 0.6)
                val rx = (0.15 * u / 3).toFloat()
                c.drawRoundRect(RectF((x0 + 0.95 * u).toFloat(), (y0 + 0.86 * u).toFloat(), (x0 + 1.95 * u).toFloat(), (y0 + 1.01 * u).toFloat()), rx, rx, p)
            }
            "dunes" -> {
                if (!dark) blob(0.85 * w, 0.2 * h, 0.35 * r, SAND2, 0.35)
                val cols = intArrayOf(SAND2, SAND, CLAY2, CLAY)
                val al = if (dark) doubleArrayOf(0.16, 0.24, 0.34, 0.46) else doubleArrayOf(0.5, 0.5, 0.5, 0.55)
                val fr = doubleArrayOf(0.9, 1.3, 0.8, 1.1)
                val ph = doubleArrayOf(0.3, 1.9, 3.1, 4.4)
                for (i in 0 until 4) {
                    val path = Path().apply { moveTo(0f, h.toFloat()) }
                    for (kk in 0..64) {
                        val x = kk / 64.0 * w
                        path.lineTo(x.toFloat(), (h * (0.54 + i * 0.12) + 0.055 * h * sin(2 * PI * (x / w) * fr[i] + ph[i])).toFloat())
                    }
                    path.lineTo(w.toFloat(), h.toFloat()); path.close()
                    p.reset(); p.isAntiAlias = true; p.color = withAlpha(cols[i], al[i])
                    c.drawPath(path, p)
                }
            }
            "aurora" -> {
                blob(0.85 * w, 0.95 * h, 0.55 * r, CLAY, 0.6)
                blob(0.5 * w, 1.08 * h, 0.45 * r, VIOLET, 0.38)
                blob(1.05 * w, 0.4 * h, 0.4 * r, SKY, 0.32)
                blob(0.12 * w, 1.1 * h, 0.35 * r, SAND, 0.4)
            }
            "night" -> {
                val g = Rng(7)
                val n = (w * h / 650).roundToInt()
                repeat(n) {
                    val q = g.next()
                    val x = g.next() * w
                    val y = g.next() * h
                    dot(x, y, 0.4 + q * q * q * 1.3, ink, 0.2 + g.next() * 0.55)
                }
                fun ell(rx: Double, ry: Double, a: Double, wd: Double) {
                    val cx = 0.98 * w
                    val cy = 1.18 * h
                    val rot = -12 * PI / 180
                    val pts = (0..120).map { kk ->
                        val th = kk / 120.0 * PI * 2
                        val ex = rx * cos(th)
                        val ey = ry * sin(th)
                        (cx + ex * cos(rot) - ey * sin(rot)) to (cy + ex * sin(rot) + ey * cos(rot))
                    }
                    line(pts, CLAY, a, wd)
                }
                blob(0.98 * w, 1.15 * h, 0.5 * r, CLAY, 0.25)
                ell(0.82 * w, 0.58 * h, 0.4, 1.1)
                ell(0.62 * w, 0.42 * h, 0.25, 0.9)
                for ((fx, fy, sz) in listOf(Triple(0.86, 0.12, 7.0), Triple(0.94, 0.8, 5.0), Triple(0.68, 0.9, 4.0))) {
                    val x = (fx * w).toFloat()
                    val y = (fy * h).toFloat()
                    val a = sz.toFloat()
                    val path = Path().apply {
                        moveTo(x, y - a); quadTo(x, y, x + a, y); quadTo(x, y, x, y + a); quadTo(x, y, x - a, y); quadTo(x, y, x, y - a); close()
                    }
                    p.reset(); p.isAntiAlias = true; p.color = withAlpha(CLAY, 0.75)
                    p.style = Paint.Style.FILL_AND_STROKE; p.strokeWidth = a * 0.22f; p.strokeJoin = Paint.Join.ROUND
                    c.drawPath(path, p)
                }
            }
        }
    }
}
