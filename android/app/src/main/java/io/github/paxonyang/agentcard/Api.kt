package io.github.paxonyang.agentcard

import android.content.Context
import android.content.SharedPreferences
import java.net.HttpURLConnection
import java.net.URL

/** 设置和上一次拿到的数据都放这里 / settings and the last fetched data */
class Prefs(context: Context) {
    private val p: SharedPreferences = context.applicationContext.getSharedPreferences("card", Context.MODE_PRIVATE)

    var url: String
        get() = p.getString("url", "") ?: ""
        set(v) = p.edit().putString("url", v).apply()
    var cfId: String
        get() = p.getString("cfId", "") ?: ""
        set(v) = p.edit().putString("cfId", v).apply()
    var cfSecret: String
        get() = p.getString("cfSecret", "") ?: ""
        set(v) = p.edit().putString("cfSecret", v).apply()

    /** 上一次成功拿到的数据（原样 JSON）/ the last good payload, raw JSON */
    var lastJson: String
        get() = p.getString("lastJson", "") ?: ""
        set(v) = p.edit().putString("lastJson", v).apply()
    var lastOkAt: Long
        get() = p.getLong("lastOkAt", 0)
        set(v) = p.edit().putLong("lastOkAt", v).apply()
    /** 上一次失败的原因（空 = 上一次成功）/ why the last fetch failed, empty when it worked */
    var lastError: String
        get() = p.getString("lastError", "") ?: ""
        set(v) = p.edit().putString("lastError", v).apply()
    var liveUntil: Long
        get() = p.getLong("liveUntil", 0)
        set(v) = p.edit().putLong("liveUntil", v).apply()

    fun data(): WidgetData? = lastJson.takeIf { it.isNotBlank() }?.let { runCatching { Model.parse(it) }.getOrNull() }
}

/** 拿数据失败的几种原因 / why a fetch failed */
enum class Fail { NO_URL, NETWORK, AUTH_NEEDED, AUTH_FAILED, NOT_BOARD, HTTP }

class FetchResult(val data: WidgetData?, val fail: Fail?, val detail: String = "", val raw: String = "")

object Api {
    /** 在后台线程调用 / call off the main thread */
    fun fetch(context: Context): FetchResult {
        val prefs = Prefs(context)
        val base = prefs.url
        if (base.isBlank()) return FetchResult(null, Fail.NO_URL).also { prefs.lastError = Fail.NO_URL.name }
        val r = get(base, prefs.cfId, prefs.cfSecret)
        if (r.data != null) {
            prefs.lastJson = r.raw
            prefs.lastOkAt = System.currentTimeMillis()
            prefs.lastError = ""
        } else {
            prefs.lastError = r.fail?.name ?: Fail.NETWORK.name
        }
        return r
    }

    fun get(base: String, cfId: String, cfSecret: String): FetchResult {
        var conn: HttpURLConnection? = null
        return try {
            conn = (URL("$base/api/widget").openConnection() as HttpURLConnection).apply {
                connectTimeout = 8000
                readTimeout = 8000
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", "AgentCard/1 (Android)")
                // Cloudflare Access 服务令牌 / Cloudflare Access service token
                if (cfId.isNotBlank() && cfSecret.isNotBlank()) {
                    setRequestProperty("CF-Access-Client-Id", cfId.trim())
                    setRequestProperty("CF-Access-Client-Secret", cfSecret.trim())
                }
            }
            val code = conn.responseCode
            val location = conn.getHeaderField("Location") ?: ""
            when {
                code in 300..399 && location.contains("cloudflareaccess.com") -> FetchResult(null, Fail.AUTH_NEEDED)
                code == 401 || code == 403 -> FetchResult(null, if (cfId.isBlank()) Fail.AUTH_NEEDED else Fail.AUTH_FAILED, "HTTP $code")
                code == 404 -> FetchResult(null, Fail.NOT_BOARD, "HTTP 404")
                code !in 200..299 -> FetchResult(null, Fail.HTTP, "HTTP $code")
                else -> {
                    val body = conn.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                    try {
                        FetchResult(Model.parse(body), null, raw = body)
                    } catch (e: Exception) {
                        FetchResult(null, Fail.NOT_BOARD, e.message ?: "")
                    }
                }
            }
        } catch (e: Exception) {
            FetchResult(null, Fail.NETWORK, e.javaClass.simpleName + (e.message?.let { ": $it" } ?: ""))
        } finally {
            conn?.disconnect()
        }
    }

    /** fetch() + 存下来 + 刷新所有卡片 / fetch, store and redraw every card */
    fun refresh(context: Context): FetchResult {
        val r = fetch(context)
        CardWidget.renderAll(context)
        return r
    }
}
