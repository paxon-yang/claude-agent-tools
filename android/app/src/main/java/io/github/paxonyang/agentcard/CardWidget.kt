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
import android.util.SizeF
import android.widget.RemoteViews

/** 桌面卡片 / the home-screen card */
class CardWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        renderAll(context)
        RefreshWorker.schedule(context)
        RefreshWorker.now(context)
    }

    // 用户拖动改了卡片大小，或者折叠屏展开/合上：按新大小重画 / resized, or a foldable opened/closed: redraw at the new size
    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        manager.updateAppWidget(id, views(context, newOptions))
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
            for (id in ids) manager.updateAppWidget(id, views(context, manager.getAppWidgetOptions(id)))
        }

        private fun pi(context: Context, code: Int, intent: Intent, activity: Boolean): PendingIntent {
            val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
            return if (activity) PendingIntent.getActivity(context, code, intent, flags)
            else PendingIntent.getBroadcast(context, code, intent, flags)
        }

        /**
         * 按小组件的实际大小画。安卓 12 起一个小组件可能有好几种大小（横屏、竖屏、折叠屏），每种画一张。
         * Paint at the widget's real size. From Android 12 a widget can have several sizes (portrait, landscape,
         * folded/unfolded); one picture per size.
         */
        fun views(context: Context, options: Bundle?): RemoteViews {
            val sizes = if (Build.VERSION.SDK_INT >= 31) {
                @Suppress("DEPRECATION")
                options?.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES)?.filter { it.width > 0 && it.height > 0 }
            } else null
            if (Build.VERSION.SDK_INT >= 31 && !sizes.isNullOrEmpty()) {
                val distinct = sizes.distinctBy { "${it.width.toInt()}x${it.height.toInt()}" }.take(3)
                if (distinct.size > 1) return RemoteViews(distinct.associateWith { build(context, it.width, it.height) })
                return build(context, distinct[0].width, distinct[0].height)
            }
            // 竖屏时宽取最小宽度、高取最大高度 / portrait: min width, max height
            val w = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0)?.takeIf { it > 0 } ?: 320
            val h = options?.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0)?.takeIf { it > 0 } ?: 180
            return build(context, w.toFloat(), h.toFloat())
        }

        /** 一种大小的卡片（dp）/ the card at one size, in dp */
        fun build(context: Context, wDp: Float, hDp: Float): RemoteViews {
            val prefs = Prefs(context)
            val rv = RemoteViews(context.packageName, R.layout.widget_card)
            val (wPx, hPx, scale) = Render.pixels(wDp, hDp, context.resources.displayMetrics.density)
            rv.setImageViewBitmap(R.id.img, Render.card(context, wPx, hPx, scale))
            rv.setContentDescription(R.id.img, describe(context))

            val settings = pi(context, 2, Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), true)
            if (prefs.url.isBlank()) {
                rv.setOnClickPendingIntent(R.id.card, settings)
                rv.setOnClickPendingIntent(R.id.open, settings)
            } else {
                rv.setOnClickPendingIntent(R.id.card, pi(context, 1, Intent(context, CardWidget::class.java).setAction(ACTION_TAP), false))
                rv.setOnClickPendingIntent(R.id.open, pi(context, 3, Intent(Intent.ACTION_VIEW, Uri.parse(prefs.boardOrUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK), true))
            }
            return rv
        }

        /** 读屏用的文字说明 / a spoken summary for screen readers */
        private fun describe(context: Context): String {
            val d = Prefs(context).data() ?: return context.getString(R.string.app_name)
            val s = d.session ?: return context.getString(R.string.st_none)
            return listOfNotNull(s.project, s.task, s.model, s.needMsg, d.limits?.sevenDay?.let { context.getString(R.string.q_week) + " " + it.pct.toInt() + "%" }).joinToString(", ")
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
