package io.github.paxonyang.agentcard

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.view.View
import android.widget.RemoteViews
import java.text.DateFormat
import java.util.Date
import kotlin.math.roundToInt

/** 桌面卡片 / the home-screen card */
class CardWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        renderAll(context)
        RefreshWorker.schedule(context)
        RefreshWorker.now(context)
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
        if (intent.action == ACTION_TAP) LiveService.start(context)
    }

    companion object {
        const val ACTION_TAP = "io.github.paxonyang.agentcard.TAP"

        fun renderAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, CardWidget::class.java))
            if (ids.isEmpty()) return
            manager.updateAppWidget(ids, build(context))
        }

        private fun pi(context: Context, code: Int, intent: Intent, activity: Boolean): PendingIntent {
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            return if (activity) PendingIntent.getActivity(context, code, intent, flags)
            else PendingIntent.getBroadcast(context, code, intent, flags)
        }

        /** 画一张卡片（设置页的预览也用它）/ draw one card; the settings page preview uses it too */
        fun build(context: Context): RemoteViews {
            val prefs = Prefs(context)
            val rv = RemoteViews(context.packageName, R.layout.widget_card)
            val settings = pi(context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), true)
            val url = prefs.url
            if (url.isBlank()) {
                rv.setOnClickPendingIntent(R.id.card, settings)
                rv.setOnClickPendingIntent(R.id.open, settings)
            } else {
                rv.setOnClickPendingIntent(R.id.card, pi(context, 1, Intent(context, CardWidget::class.java).setAction(ACTION_TAP), false))
                rv.setOnClickPendingIntent(R.id.open, pi(context, 3, Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), true))
            }

            val data = prefs.data()
            val err = prefs.lastError
            val time = { ms: Long -> DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(ms)) }
            if (data == null) {
                rv.setTextViewText(R.id.project, context.getString(R.string.app_name))
                rv.setViewVisibility(R.id.status, View.GONE)
                rv.setTextViewText(R.id.task, errorText(context, if (url.isBlank()) Fail.NO_URL.name else err.ifBlank { Fail.NETWORK.name }))
                rv.setViewVisibility(R.id.dot, View.GONE)
                rv.setTextViewText(R.id.model, "")
                rv.setChronometer(R.id.timer, SystemClock.elapsedRealtime(), null, false)
                rv.setViewVisibility(R.id.timer, View.GONE)
                rv.setTextViewText(R.id.meta, if (url.isBlank()) "" else url.removePrefix("https://").removePrefix("http://"))
                rv.setViewVisibility(R.id.need, View.GONE)
                rv.setViewVisibility(R.id.now, View.GONE)
                rv.setTextViewText(R.id.cost, "")
                rv.setTextViewText(R.id.updated, "")
                return rv
            }

            // 用看板的时钟，加上从拿到数据到现在过了多久（手机和电脑时间不一致也没关系）
            // server time plus the time since the fetch, so a skewed phone clock does not matter
            val sinceFetch = ((System.currentTimeMillis() - prefs.lastOkAt).coerceAtLeast(0)) / 1000.0
            val nowSec = data.now + sinceFetch
            val s = data.session
            val st = Model.status(s)

            rv.setTextViewText(R.id.project, s?.project ?: context.getString(R.string.app_name))
            rv.setViewVisibility(R.id.status, View.VISIBLE)
            val (label, bg, color) = when (st) {
                Status.RUNNING -> Triple(R.string.st_running, R.drawable.pill_running, R.color.green_l)
                Status.NEEDS_YOU -> Triple(R.string.st_need, R.drawable.pill_need, R.color.red_l)
                Status.BACKGROUND -> Triple(R.string.st_bg, R.drawable.pill_bg, R.color.blue_l)
                Status.IDLE -> Triple(R.string.st_idle, R.drawable.pill_idle, R.color.muted)
                Status.ENDED -> Triple(R.string.st_ended, R.drawable.pill_idle, R.color.muted)
                Status.NONE -> Triple(R.string.st_none, R.drawable.pill_idle, R.color.muted)
            }
            rv.setTextViewText(R.id.status, context.getString(label))
            rv.setInt(R.id.status, "setBackgroundResource", bg)
            rv.setTextColor(R.id.status, context.getColor(color))

            rv.setTextViewText(R.id.task, s?.task ?: context.getString(if (s == null) R.string.st_none else R.string.no_task))

            if (s?.model != null) {
                rv.setViewVisibility(R.id.dot, View.VISIBLE)
                rv.setInt(R.id.dot, "setColorFilter", Model.familyColor(s.family))
                rv.setTextViewText(R.id.model, s.model + (s.effort?.let { " · $it" } ?: ""))
            } else {
                rv.setViewVisibility(R.id.dot, View.GONE)
                rv.setTextViewText(R.id.model, "")
            }

            // 这一轮用了多久：卡片自己走秒，不用一直刷新 / turn timer ticks on its own between refreshes
            val started = s?.taskStartedAt
            if (s != null && started != null && s.taskEndedAt == null && s.active) {
                val base = SystemClock.elapsedRealtime() - ((nowSec - started) * 1000).toLong()
                rv.setChronometer(R.id.timer, base, null, true)
                rv.setViewVisibility(R.id.timer, View.VISIBLE)
            } else {
                rv.setChronometer(R.id.timer, SystemClock.elapsedRealtime(), null, false)
                rv.setViewVisibility(R.id.timer, View.GONE)
            }

            val parts = mutableListOf<String>()
            if (s != null) for (m in Model.meta(s, nowSec)) parts += when (m) {
                is Meta.Agents -> context.resources.getQuantityString(R.plurals.meta_agents, m.n, m.n)
                is Meta.Background -> context.getString(R.string.meta_bg, m.n)
                is Meta.CacheLeft -> context.getString(R.string.meta_cache, m.minutes)
                is Meta.Gate -> context.getString(
                    when (m.result) {
                        "pass" -> R.string.gate_pass
                        "fail" -> R.string.gate_fail
                        "giveup" -> R.string.gate_giveup
                        "timeout" -> R.string.gate_timeout
                        else -> R.string.gate_skip
                    }
                )
            }
            if (data.others.isNotEmpty()) parts += context.getString(R.string.others_running, data.others.size)
            rv.setTextViewText(R.id.meta, parts.joinToString(" · "))

            if (st == Status.NEEDS_YOU) {
                rv.setViewVisibility(R.id.need, View.VISIBLE)
                rv.setTextViewText(R.id.need, context.getString(R.string.need_prefix, s?.needMsg ?: ""))
            } else {
                rv.setViewVisibility(R.id.need, View.GONE)
            }

            val nowLine = when {
                st == Status.RUNNING && s?.now != null -> context.getString(R.string.now_doing, s.now)
                st == Status.IDLE && s?.task != null -> context.getString(R.string.waiting_you)
                else -> null
            }
            rv.setViewVisibility(R.id.now, if (nowLine == null) View.GONE else View.VISIBLE)
            rv.setTextViewText(R.id.now, nowLine ?: "")

            val t = data.totals
            val cost = t.cost
            rv.setTextViewText(
                R.id.cost,
                when {
                    cost == null -> ""
                    t.saved != null && t.saved >= 0.01 -> context.getString(
                        R.string.cost_line, t.hours, Model.money(cost), (t.saved * 100).roundToInt(),
                        t.baselineModel.replaceFirstChar { it.uppercase() },
                    )
                    else -> context.getString(R.string.cost_line_plain, t.hours, Model.money(cost))
                },
            )

            val live = prefs.liveUntil > System.currentTimeMillis()
            when {
                err.isNotBlank() -> {
                    rv.setTextViewText(R.id.updated, context.getString(R.string.stale, time(prefs.lastOkAt)))
                    rv.setTextColor(R.id.updated, context.getColor(R.color.red_l))
                }
                live -> {
                    rv.setTextViewText(R.id.updated, context.getString(R.string.live))
                    rv.setTextColor(R.id.updated, context.getColor(R.color.green_l))
                }
                else -> {
                    rv.setTextViewText(R.id.updated, context.getString(R.string.updated_at, time(prefs.lastOkAt)))
                    rv.setTextColor(R.id.updated, context.getColor(R.color.faint))
                }
            }
            return rv
        }

        fun errorText(context: Context, code: String): String = context.getString(
            when (code) {
                Fail.NO_URL.name -> R.string.err_no_url
                Fail.AUTH_NEEDED.name -> R.string.err_auth_needed
                Fail.AUTH_FAILED.name -> R.string.err_auth_failed
                Fail.NOT_BOARD.name -> R.string.err_not_board
                else -> R.string.err_network
            },
        )
    }
}
