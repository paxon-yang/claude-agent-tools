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
        private val net = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val req = PeriodicWorkRequest.Builder(RefreshWorker::class.java, 15, TimeUnit.MINUTES).setConstraints(net).build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun now(context: Context) {
            val req = OneTimeWorkRequest.Builder(RefreshWorker::class.java).setConstraints(net).build()
            WorkManager.getInstance(context).enqueueUniqueWork(ONCE, ExistingWorkPolicy.REPLACE, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(PERIODIC)
        }
    }
}
