package io.github.paxonyang.agentcard

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.SizeF
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import java.text.DateFormat
import java.util.Date
import kotlin.math.max
import kotlin.math.roundToInt

/** 桌面卡片 / the home-screen card */
class CardWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        renderAll(context)
        RefreshWorker.schedule(context)
        RefreshWorker.now(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        manager.updateAppWidget(id, build(context, sizeOf(newOptions)))
    }

    override fun onEnabled(context: Context) {
        RefreshWorker.schedule(context)
    }

    override fun onDisabled(context: Context) {
        RefreshWorker.cancel(context)
        LiveService.stop(context)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        // 点卡片：进入实时模式（有会话在跑时每 15 秒刷新）/ tap: live mode, refreshing every 15 s while busy
        when (intent.action) {
            ACTION_TAP -> LiveService.start(context)
            // 装了新版本或开机：先用上次的数据重画（不然桌面会停在空白的初始样子），再去拉新的
            // after an app update or reboot: redraw from the last data at once, then fetch fresh
            Intent.ACTION_MY_PACKAGE_REPLACED, Intent.ACTION_BOOT_COMPLETED -> {
                renderAll(context)
                if (Prefs(context).url.isNotBlank()) {
                    RefreshWorker.schedule(context)
                    RefreshWorker.now(context)
                }
            }
        }
    }

    companion object {
        const val ACTION_TAP = "io.github.paxonyang.agentcard.TAP"

        fun renderAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, CardWidget::class.java))
            if (ids.isEmpty()) return
            // 每张卡片按自己的大小画皮肤 / each card gets a skin drawn at its own size
            for (id in ids) manager.updateAppWidget(id, build(context, sizeOf(manager.getAppWidgetOptions(id))))
        }

        /** 卡片的大小（dp，竖屏）；拿不到就用默认的 4×3 / the card's size in dp (portrait), or the default 4×3 */
        fun sizeOf(o: Bundle?): Pair<Float, Float> {
            // 安卓 12 起启动器会给出卡片的真实大小 / Android 12+ launchers report the actual sizes
            if (o != null && Build.VERSION.SDK_INT >= 31) {
                @Suppress("DEPRECATION")
                val sizes = o.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)
                sizes?.firstOrNull()?.let { if (it.width > 0 && it.height > 0) return it.width to it.height }
            }
            val w = o?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) ?: 0
            val h = o?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0) ?: 0
            return (if (w > 0) w.toFloat() else 340f) to (if (h > 0) h.toFloat() else 250f)
        }

        private fun pi(context: Context, code: Int, intent: Intent, activity: Boolean): PendingIntent {
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            return if (activity) PendingIntent.getActivity(context, code, intent, flags)
            else PendingIntent.getBroadcast(context, code, intent, flags)
        }

        private fun glyphRes(family: String?): Int = when (family) {
            "haiku" -> R.drawable.g_haiku
            "sonnet" -> R.drawable.g_sonnet
            "opus" -> R.drawable.g_opus
            "fable", "mythos" -> R.drawable.g_fable
            else -> R.drawable.g_grey
        }

        /** 状态点：在跑、等你、后台三种会一闪一闪，其他是灰色静止的 / status dot: pulses when running, needs you or background */
        private fun dot(rv: RemoteViews, which: Int?) {
            for (id in intArrayOf(R.id.pulse_green, R.id.pulse_red, R.id.pulse_blue)) rv.setViewVisibility(id, if (id == which) View.VISIBLE else View.GONE)
            rv.setViewVisibility(R.id.dot_still, if (which == null) View.VISIBLE else View.GONE)
        }

        fun build(context: Context, sizeDp: Pair<Float, Float> = 340f to 250f): RemoteViews {
            val prefs = Prefs(context)
            val rv = RemoteViews(context.packageName, R.layout.widget_card)
            val color = { id: Int -> context.getColor(id) }

            // 皮肤 / skin
            val skinId = Skins.current(prefs, prefs.data())
            val skin = runCatching { Skins.draw(context, skinId, sizeDp.first, sizeDp.second) }.getOrNull()
            if (skin != null) {
                rv.setImageViewBitmap(R.id.skin, skin)
                rv.setViewVisibility(R.id.skin, View.VISIBLE)
            } else {
                rv.setViewVisibility(R.id.skin, View.GONE)
            }
            // 小狐狸浮在文字上面 / the fox floats above the text
            rv.setViewVisibility(R.id.skin_anim, if (skin != null && Skins.animated(skinId)) View.VISIBLE else View.GONE)

            val settings = pi(context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), true)
            if (prefs.url.isBlank()) {
                rv.setOnClickPendingIntent(R.id.card, settings)
                rv.setOnClickPendingIntent(R.id.open, settings)
            } else {
                rv.setOnClickPendingIntent(R.id.card, pi(context, 1, Intent(context, CardWidget::class.java).setAction(ACTION_TAP), false))
                rv.setOnClickPendingIntent(R.id.open, pi(context, 3, Intent(Intent.ACTION_VIEW, Uri.parse(prefs.boardOrUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), true))
            }

            val d = prefs.data()
            val err = prefs.lastError
            if (d == null) {
                // 还没连上 / not connected yet
                dot(rv, null)
                rv.setTextViewText(R.id.status, context.getString(R.string.app_name))
                rv.setTextColor(R.id.status, color(R.color.c_label))
                rv.setTextViewText(R.id.project, "")
                rv.setViewVisibility(R.id.glyph, View.GONE)
                rv.setTextViewTextSize(R.id.model, TypedValue.COMPLEX_UNIT_SP, 16f)
                rv.setTextViewText(R.id.model, errorText(context, if (prefs.url.isBlank()) Fail.NO_URL.name else err.ifBlank { Fail.NETWORK.name }))
                rv.setTextViewText(R.id.sub, prefs.url.removePrefix("https://").removePrefix("http://"))
                rv.setChronometer(R.id.timer, SystemClock.elapsedRealtime(), null, false)
                rv.setViewVisibility(R.id.timer, View.GONE)
                rv.setViewVisibility(R.id.quota, View.GONE)
                rv.setViewVisibility(R.id.rows, View.GONE)
                rv.setViewVisibility(R.id.line, View.GONE)
                rv.setTextViewText(R.id.cost, "")
                rv.setTextViewText(R.id.updated, "")
                return rv
            }

            val sinceFetch = ((System.currentTimeMillis() - prefs.lastOkAt).coerceAtLeast(0)) / 1000.0
            val nowSec = d.now + sinceFetch
            val s = d.session
            val st = Model.status(s)

            // 状态 / status
            val (label, tint, pulse) = when (st) {
                Status.RUNNING -> Triple(R.string.st_running, R.color.c_green, R.id.pulse_green)
                Status.NEEDS_YOU -> Triple(R.string.st_need, R.color.c_red, R.id.pulse_red)
                Status.BACKGROUND -> Triple(R.string.st_bg, R.color.c_blue, R.id.pulse_blue)
                Status.IDLE -> Triple(R.string.st_idle, R.color.c_label2, null)
                Status.ENDED -> Triple(R.string.st_ended, R.color.c_label2, null)
                Status.NONE -> Triple(R.string.st_none, R.color.c_label2, null)
            }
            dot(rv, pulse)
            rv.setTextViewText(R.id.status, context.getString(label))
            rv.setTextColor(R.id.status, color(tint))
            rv.setTextViewText(R.id.project, (s?.project ?: "") + if (d.others.isNotEmpty()) "  +${d.others.size}" else "")

            // 模型 / model
            rv.setTextViewTextSize(R.id.model, TypedValue.COMPLEX_UNIT_SP, 21f)
            if (s?.model != null) {
                rv.setViewVisibility(R.id.glyph, View.VISIBLE)
                rv.setInt(R.id.glyph, "setBackgroundResource", glyphRes(s.family))
                rv.setTextViewText(R.id.glyph, Model.glyph(s.family, s.model))
                rv.setTextViewText(R.id.model, s.model)
            } else {
                rv.setViewVisibility(R.id.glyph, View.GONE)
                rv.setTextViewText(R.id.model, context.getString(R.string.app_name))
            }
            val sub = listOfNotNull(
                s?.effort,
                s?.agentsRunning?.takeIf { it > 0 }?.let { context.getString(R.string.sub_agents, it) },
                s?.bgRunning?.takeIf { it > 0 }?.let { context.getString(R.string.sub_bg, it) },
            ).joinToString(" · ")
            rv.setTextViewText(R.id.sub, sub)
            // 这一轮的计时器：自己按秒走 / the turn timer ticks by itself
            val started = s?.taskStartedAt
            if (s != null && started != null && s.taskEndedAt == null && s.active && st != Status.IDLE) {
                val base = SystemClock.elapsedRealtime() - ((nowSec - started) * 1000).toLong()
                rv.setChronometer(R.id.timer, base, if (sub.isEmpty()) "%s" else " · %s", true)
                rv.setViewVisibility(R.id.timer, View.VISIBLE)
            } else {
                rv.setChronometer(R.id.timer, SystemClock.elapsedRealtime(), null, false)
                rv.setViewVisibility(R.id.timer, View.GONE)
            }

            // 本周额度圆环 / weekly-usage ring
            val wk = d.limits?.sevenDay
            if (wk != null) {
                rv.setViewVisibility(R.id.quota, View.VISIBLE)
                rv.setImageViewBitmap(R.id.ring, Ring.draw(context, wk.pct))
                rv.setContentDescription(R.id.ring, context.getString(R.string.q_week) + " " + wk.pct.roundToInt() + "%")
                val five = d.limits?.fiveHour
                // 额度只在 Claude Code 调用模型时更新；超过 15 分钟没更新就写"截至几点" / usage only updates on Claude Code calls: label old figures
                val at = d.limits?.at
                val asOf = if (at != null && nowSec - at > 15 * 60) DateFormat.getTimeInstance(DateFormat.SHORT).format(Date((at * 1000).toLong())) else null
                rv.setTextViewText(R.id.quota_sub, when {
                    asOf != null -> context.getString(R.string.q_as_of, asOf)
                    five != null -> context.getString(R.string.q_5h, five.pct.roundToInt())
                    else -> ""
                })
            } else if (d.version < 2) {
                // 旧版看板没有额度数据：提示更新 / an older board sends no usage: say so
                rv.setViewVisibility(R.id.quota, View.VISIBLE)
                rv.setImageViewBitmap(R.id.ring, Ring.draw(context, null))
                rv.setTextViewText(R.id.quota_sub, context.getString(R.string.quota_update))
            } else {
                rv.setViewVisibility(R.id.quota, View.GONE)
            }

            // 中间 / middle
            rv.removeAllViews(R.id.rows)
            var running = s?.running.orEmpty()
            // 电脑上的看板还是旧版本：只知道有几个在跑，不知道是谁 / an older board only sends counts
            if (running.isEmpty() && s != null && (s.agentsRunning + s.bgRunning) > 0 && d.version < 2) {
                running = listOf(Run("agent", context.getString(R.string.sub_agents, s.agentsRunning + s.bgRunning), null, null, context.getString(R.string.update_board)))
            }
            fun addRows(max: Int) {
                rv.setViewVisibility(R.id.rows, if (running.isEmpty()) View.GONE else View.VISIBLE)
                for (r in running.take(max)) {
                    val row = RemoteViews(context.packageName, R.layout.widget_run_row)
                    val bg = r.kind == "bg"
                    row.setInt(R.id.r_glyph, "setBackgroundResource", if (bg || r.family == null) R.drawable.g_grey else glyphRes(r.family))
                    row.setTextViewText(R.id.r_glyph, if (bg) "›_" else if (r.family == null && r.model == null) "·" else Model.glyph(r.family, r.model ?: r.name))
                    row.setTextViewText(R.id.r_name, r.name)
                    row.setTextViewText(R.id.r_text, listOfNotNull(r.model, r.text).joinToString(" · "))
                    rv.addView(R.id.rows, row)
                }
            }
            when {
                // 等你确认：红条在上，下面照样列出在跑的 / needs you: the red bar on top, running work still listed below
                st == Status.NEEDS_YOU -> {
                    rv.setViewVisibility(R.id.line, View.VISIBLE)
                    rv.setInt(R.id.line, "setBackgroundResource", R.drawable.need_fill)
                    rv.setTextColor(R.id.line, color(R.color.c_red))
                    rv.setTextViewText(R.id.line, s?.needMsg ?: context.getString(R.string.st_need))
                    addRows(3)
                }
                running.isNotEmpty() -> {
                    rv.setViewVisibility(R.id.line, View.GONE)
                    addRows(4)
                }
                else -> {
                    rv.setViewVisibility(R.id.rows, View.GONE)
                    val text = when {
                        st == Status.RUNNING && s?.now != null -> s.now
                        st == Status.IDLE && s?.task != null -> context.getString(R.string.waiting_you)
                        else -> null
                    }
                    rv.setViewVisibility(R.id.line, if (text == null) View.GONE else View.VISIBLE)
                    rv.setInt(R.id.line, "setBackgroundResource", R.drawable.row_fill)
                    rv.setTextColor(R.id.line, color(R.color.c_label2))
                    rv.setTextViewText(R.id.line, text ?: "")
                }
            }

            // 页脚 / footer
            val t = d.totals
            val cost = t.cost
            rv.setTextViewText(
                R.id.cost,
                when {
                    cost == null -> ""
                    t.saved != null && t.saved >= 0.01 -> context.getString(R.string.cost_short, t.hours, Model.money(cost), (t.saved * 100).roundToInt())
                    else -> context.getString(R.string.cost_short_plain, t.hours, Model.money(cost))
                },
            )
            val clock = { ms: Long -> if (ms <= 0) "—" else DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ms)) }
            when {
                err.isNotBlank() -> {
                    rv.setTextViewText(R.id.updated, context.getString(R.string.stale, clock(prefs.lastOkAt)))
                    rv.setTextColor(R.id.updated, color(R.color.c_red))
                }
                prefs.liveUntil > System.currentTimeMillis() -> {
                    rv.setTextViewText(R.id.updated, context.getString(R.string.live))
                    rv.setTextColor(R.id.updated, color(R.color.c_green))
                }
                else -> {
                    rv.setTextViewText(R.id.updated, clock(max(prefs.lastOkAt, 0)))
                    rv.setTextColor(R.id.updated, color(R.color.c_label3))
                }
            }
            rv.setContentDescription(R.id.card, listOfNotNull(s?.project, context.getString(label), s?.model, wk?.let { context.getString(R.string.q_week) + " " + it.pct.roundToInt() + "%" }).joinToString(", "))
            return rv
        }

        fun errorText(context: Context, code: String): String = context.getString(
            when (code) {
                Fail.NO_URL.name -> R.string.err_no_url
                Fail.AUTH_NEEDED.name -> R.string.err_auth_needed
                Fail.AUTH_FAILED.name -> R.string.err_auth_failed
                Fail.KEY_REJECTED.name -> R.string.err_key
                Fail.NOT_BOARD.name -> R.string.err_not_board
                else -> R.string.err_network
            },
        )
    }
}
