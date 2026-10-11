package io.github.paxonyang.agentcard

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.PeriodicWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/** 每 15 分钟刷新一次卡片（安卓允许的最短间隔）/ refresh the card every 15 minutes, the shortest Android allows */
class RefreshWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        Api.refresh(applicationContext)
        return Result.success()
    }

    companion object {
        private const val PERIODIC = "card-refresh"
        private const val ONCE = "card-refresh-now"
        private const val FOLLOW = "card-refresh-follow"
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val req = PeriodicWorkRequest.Builder(RefreshWorker::class.java, 15, TimeUnit.MINUTES).setConstraints(net).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun now(context: Context) {
            val req = OneTimeWorkRequest.Builder(RefreshWorker::class.java).setConstraints(net).build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, req)
        }

        /**
         * 定时刷新最短 15 分钟，太慢。有会话在跑时 2 分钟后再刷一次，刚闲下来的一小时里 5 分钟一次，之后回到 15 分钟。
         * The periodic refresh can't run more often than every 15 minutes. While a session is busy, refresh again
         * in 2 minutes; for an hour after it goes quiet, every 5 minutes; then back to the 15-minute schedule.
         */
        fun followUp(context: Context, d: WidgetData) {
            val prefs = Prefs(context)
            val now = System.currentTimeMillis()
            val busy = Model.busy(d)
            if (busy) prefs.lastBusyAt = now
            val minutes = when {
                busy -> 2L
                now - prefs.lastBusyAt < 60 * 60_000 -> 5L
                else -> return
            }
            val req = OneTimeWorkRequest.Builder(RefreshWorker::class.java).setInitialDelay(minutes, TimeUnit.MINUTES).setConstraints(net).build()
            WorkManager.getInstance(context).enqueueUniqueWork(FOLLOW, ExistingWorkPolicy.REPLACE, req)
        }

        fun cancelFollowUp(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(FOLLOW)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
            WorkManager.getInstance(context).cancelUniqueWork(FOLLOW)
        }
    }
}
