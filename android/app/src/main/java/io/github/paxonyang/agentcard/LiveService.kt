package io.github.paxonyang.agentcard

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.Executors

/**
 * 实时模式：点卡片后启动。有会话在跑时每 15 秒刷新卡片；连续 10 分钟没事、2 小时到了、或一直连不上，就自己停。
 * Live mode, started by tapping the card: refresh every 15 s while a session is busy; stops itself after
 * 10 quiet minutes, after 2 hours, or when the board stays unreachable.
 */
class LiveService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var startedAt = 0L
    private var lastBusy = 0L
    private var failures = 0
    private var running = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            finish()
            return START_NOT_STICKY
        }
        val now = System.currentTimeMillis()
        startedAt = now
        lastBusy = now
        failures = 0
        Prefs(this).liveUntil = now + MAX_MS
        val n = notification(getString(R.string.notif_connecting), null)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(NOTIF_ID, n)
        if (!running) {
            running = true
            tick()
        }
        return START_NOT_STICKY
    }

    private fun tick() {
        if (!running) return
        io.execute {
            val r = Api.refresh(this)
            main.post { after(r) }
        }
    }

    private fun after(r: FetchResult) {
        if (!running) return
        val now = System.currentTimeMillis()
        if (r.data == null) failures++ else failures = 0
        if (Model.busy(r.data)) lastBusy = now
        updateNotification(r)
        if (failures >= 6 || now - lastBusy > QUIET_MS || now - startedAt > MAX_MS) {
            finish()
            return
        }
        main.postDelayed({ tick() }, EVERY_MS)
    }

    private fun updateNotification(r: FetchResult) {
        val d = r.data
        val s = d?.session
        val title = s?.project ?: getString(R.string.app_name)
        val text = when {
            d == null -> CardWidget.errorText(this, r.fail?.name ?: Fail.NETWORK.name)
            Model.status(s) == Status.NEEDS_YOU -> getString(R.string.st_need) + (s?.needMsg?.let { " · $it" } ?: "")
            Model.busy(d) -> listOfNotNull(
                s?.model?.let { it + (s.effort?.let { e -> " · $e" } ?: "") },
                s?.agentsRunning?.takeIf { it > 0 }?.let { resources.getQuantityString(R.plurals.meta_agents, it, it) },
                s?.task,
            ).joinToString(" · ")
            else -> getString(R.string.notif_idle)
        }
        // 没给通知权限时只是看不到通知，实时刷新照常 / without the notification permission the card still refreshes
        if (Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            getSystemService(NotificationManager::class.java).notify(NOTIF_ID, notification(text, title))
        }
    }

    private fun notification(text: String, title: String?): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.notif_channel), NotificationManager.IMPORTANCE_LOW))
        }
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val stop = PendingIntent.getService(this, 10, Intent(this, LiveService::class.java).setAction(ACTION_STOP), flags)
        val url = Prefs(this).boardOrUrl
        val open = if (url.isNotBlank()) PendingIntent.getActivity(this, 11, Intent(Intent.ACTION_VIEW, Uri.parse(url)), flags) else null
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(title ?: getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(null as Icon?, getString(R.string.notif_stop), stop).build())
            .build()
    }

    private fun finish() {
        running = false
        main.removeCallbacksAndMessages(null)
        Prefs(this).liveUntil = 0
        CardWidget.renderAll(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        running = false
        main.removeCallbacksAndMessages(null)
        io.shutdown()
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "live"
        private const val NOTIF_ID = 7
        private const val ACTION_STOP = "io.github.paxonyang.agentcard.STOP"
        private const val EVERY_MS = 15_000L
        private const val QUIET_MS = 10 * 60_000L
        private const val MAX_MS = 2 * 60 * 60_000L

        fun start(context: Context) {
            try {
                context.startForegroundService(Intent(context, LiveService::class.java))
            } catch (e: Exception) {
                // 系统不让在后台启动（不是从卡片点进来的）：至少刷新一次 / not allowed from the background: refresh once instead
                RefreshWorker.now(context)
            }
        }

        fun stop(context: Context) {
            if (Prefs(context).liveUntil > System.currentTimeMillis()) {
                try {
                    context.startService(Intent(context, LiveService::class.java).setAction(ACTION_STOP))
                } catch (e: Exception) {
                    Prefs(context).liveUntil = 0
                }
            }
        }
    }
}
