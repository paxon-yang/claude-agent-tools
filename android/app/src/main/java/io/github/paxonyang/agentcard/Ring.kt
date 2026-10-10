package io.github.paxonyang.agentcard

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import kotlin.math.roundToInt

/**
 * 本周额度圆环（像苹果的电池、健身圆环小组件）：一圈底色、一段进度，中间是百分比。
 * The weekly-usage ring, in the manner of Apple's Batteries and Activity widgets: a track, an arc, the percentage inside.
 */
object Ring {
    fun draw(context: Context, pct: Double?, sizeDp: Float = 62f): Bitmap {
        val d = context.resources.displayMetrics.density
        val px = (sizeDp * d).roundToInt().coerceAtLeast(1)
        val bmp = Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val dark = (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        val stroke = 6.5f * d
        val r = RectF(stroke / 2, stroke / 2, px - stroke / 2, px - stroke / 2)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = stroke
            strokeCap = Paint.Cap.ROUND
        }
        p.color = if (dark) 0x2EFFFFFF else 0x14000000
        c.drawOval(r, p)
        val label = context.getColor(R.color.c_label)
        val label3 = context.getColor(R.color.c_label3)
        if (pct != null) {
            val v = pct.coerceIn(0.0, 100.0)
            p.color = context.getColor(
                when (Model.quotaLevel(v)) {
                    2 -> R.color.c_red
                    1 -> R.color.c_orange
                    else -> R.color.c_green
                },
            )
            if (v > 0.5) c.drawArc(r, -90f, (360 * v / 100).toFloat().coerceAtLeast(4f), false, p)
        }
        val t = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            color = label
            textSize = 15f * d
            letterSpacing = -0.02f
        }
        val cx = px / 2f
        c.drawText(if (pct == null) "—" else "${pct.roundToInt()}%", cx, px / 2f + 2f * d, t)
        t.typeface = Typeface.DEFAULT
        t.textSize = 9.5f * d
        t.letterSpacing = 0f
        t.color = label3
        c.drawText(context.getString(R.string.ring_week), cx, px / 2f + 14f * d, t)
        return bmp
    }
}
