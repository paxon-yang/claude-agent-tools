package io.github.paxonyang.agentcard

import org.json.JSONObject

/**
 * 看板 /api/widget 返回的数据。只用到卡片要显示的字段。
 * What the board's /api/widget returns; only the fields the card shows.
 */
data class Session(
    val project: String,
    val status: String,
    val active: Boolean,
    val task: String?,
    val taskStartedAt: Double?,
    val taskEndedAt: Double?,
    val model: String?,
    val family: String?,
    val effort: String?,
    val agentsRunning: Int,
    val bgRunning: Int,
    val now: String?,
    val needMsg: String?,
    val cacheUntil: Double?,
    val gate: String?,
    val reason: String? = null,
    val running: List<Run> = emptyList(),
)

/** 在跑的子代理或后台任务 / a running sub-agent or background task */
data class Run(val kind: String, val name: String, val model: String?, val family: String?, val text: String?)

/** 订阅额度的一个窗口 / one plan-usage window */
data class Limit(val pct: Double, val resetsAt: String?)
data class Limits(val sevenDay: Limit?, val fiveHour: Limit?)

data class Other(val project: String, val status: String)

data class Totals(val cost: Double?, val baseline: Double?, val saved: Double?, val hours: Int, val baselineModel: String)

data class WidgetData(
    val now: Double,
    val session: Session?,
    val others: List<Other>,
    val needsYou: Int,
    val totals: Totals,
    val limits: Limits? = null,
)

/** 卡片上的状态 / the status the card shows */
enum class Status { RUNNING, NEEDS_YOU, BACKGROUND, IDLE, ENDED, NONE }

/** 模型旁边那一串小标签 / the small tags beside the model */
sealed class Meta {
    data class Agents(val n: Int) : Meta()
    data class Background(val n: Int) : Meta()
    data class CacheLeft(val minutes: Int) : Meta()
    data class Gate(val result: String) : Meta()
}

object Model {
    private fun JSONObject.str(k: String): String? = if (isNull(k)) null else optString(k).takeIf { it.isNotBlank() }
    private fun JSONObject.num(k: String): Double? = if (isNull(k) || !has(k)) null else optDouble(k).takeIf { !it.isNaN() }

    fun parse(text: String): WidgetData {
        val o = JSONObject(text)
        require(o.optInt("v", 0) >= 1) { "not a widget payload" }
        val s = o.optJSONObject("session")?.let {
            Session(
                project = it.str("project") ?: "?",
                status = it.str("status") ?: "idle",
                active = it.optBoolean("active", false),
                task = it.str("task"),
                taskStartedAt = it.num("taskStartedAt"),
                taskEndedAt = it.num("taskEndedAt"),
                model = it.str("model"),
                family = it.str("family"),
                effort = it.str("effort"),
                agentsRunning = it.optInt("agentsRunning", 0),
                bgRunning = it.optInt("bgRunning", 0),
                now = it.str("now"),
                needMsg = it.str("needMsg"),
                cacheUntil = it.num("cacheUntil"),
                gate = it.str("gate"),
                reason = it.str("reason"),
                running = buildList {
                    val a = it.optJSONArray("running")
                    if (a != null) for (i in 0 until a.length()) {
                        val x = a.optJSONObject(i) ?: continue
                        add(Run(x.str("kind") ?: "agent", x.str("name") ?: "?", x.str("model"), x.str("family"), x.str("text")))
                    }
                },
            )
        }
        val others = buildList {
            val a = o.optJSONArray("others")
            if (a != null) for (i in 0 until a.length()) {
                val x = a.optJSONObject(i) ?: continue
                add(Other(x.str("project") ?: "?", x.str("status") ?: "idle"))
            }
        }
        val t = o.optJSONObject("totals") ?: JSONObject()
        val lim = o.optJSONObject("limits")?.let { l ->
            fun one(k: String) = l.optJSONObject(k)?.let { x -> x.num("pct")?.let { Limit(it, x.str("resetsAt")) } }
            Limits(one("sevenDay"), one("fiveHour")).takeIf { it.sevenDay != null || it.fiveHour != null }
        }
        return WidgetData(
            now = o.optDouble("now", 0.0),
            session = s,
            others = others,
            needsYou = o.optInt("needsYou", 0),
            totals = Totals(t.num("cost"), t.num("baseline"), t.num("saved"), t.optInt("hours", 24), t.str("baselineModel") ?: "opus"),
            limits = lim,
        )
    }

    fun status(s: Session?): Status = when {
        s == null -> Status.NONE
        !s.active || s.status == "ended" -> Status.ENDED
        s.status == "needs-you" -> Status.NEEDS_YOU
        s.status == "running" -> Status.RUNNING
        s.status == "background" -> Status.BACKGROUND
        else -> Status.IDLE
    }

    /** 有事在做（实时模式要继续刷新）/ something is going on (live mode keeps refreshing) */
    fun busy(d: WidgetData?): Boolean =
        d != null && (status(d.session) in setOf(Status.RUNNING, Status.NEEDS_YOU, Status.BACKGROUND) ||
            d.others.any { it.status == "running" || it.status == "needs-you" || it.status == "background" })

    /** nowSec = 手机当前时间（秒）/ the phone's clock in seconds */
    fun meta(s: Session, nowSec: Double): List<Meta> = buildList {
        if (s.agentsRunning > 0) add(Meta.Agents(s.agentsRunning))
        if (s.bgRunning > 0) add(Meta.Background(s.bgRunning))
        val c = s.cacheUntil
        if (c != null && s.active) {
            val m = kotlin.math.ceil((c - nowSec) / 60.0).toInt()
            if (m > 0) add(Meta.CacheLeft(m))
        }
        s.gate?.let { add(Meta.Gate(it)) }
    }

    /** 效果档位 → 亮几格（共 4 格）/ effort → how many of the 4 bars are lit */
    fun effortBars(e: String?): Int = when (e) {
        "low" -> 1
        "medium" -> 2
        "high" -> 3
        "xhigh", "max" -> 4
        else -> 0
    }

    /** 模型名的首字母，放在彩色小方块里 / the model's letter in the coloured square */
    fun glyph(family: String?, model: String?): String = when (family) {
        "haiku" -> "H"
        "sonnet" -> "S"
        "opus" -> "O"
        "fable", "mythos" -> "F"
        else -> (model?.firstOrNull()?.uppercase() ?: "?")
    }

    /** 浅一点的模型颜色（文字和高亮用）/ the lighter model colour, for text and highlights */
    fun familyLight(f: String?): Int = when (f) {
        "haiku" -> 0xFF5AC8D8.toInt()
        "sonnet" -> 0xFF409CFF.toInt()
        "opus" -> 0xFFFFB340.toInt()
        "fable", "mythos" -> 0xFFDA8FFF.toInt()
        else -> 0xFFAEAEB2.toInt()
    }

    /** 额度条颜色：60% 以下绿，85% 以下橙，再高红 / bar colour: green < 60 %, orange < 85 %, red above */
    fun quotaLevel(pct: Double): Int = when {
        pct >= 85 -> 2
        pct >= 60 -> 1
        else -> 0
    }

    /** 模型颜色 / model colour */
    fun familyColor(f: String?): Int = when (f) {
        "haiku" -> 0xFF1FA2B8.toInt()
        "sonnet" -> 0xFF0A7AFF.toInt()
        "opus" -> 0xFFF08C00.toInt()
        "fable", "mythos" -> 0xFFA64BD6.toInt()
        else -> 0xFF8E8E93.toInt()
    }

    fun money(x: Double): String = when {
        x < 0.01 -> "<$0.01"
        x >= 100 -> "$" + String.format(java.util.Locale.US, "%.0f", x)
        else -> "$" + String.format(java.util.Locale.US, "%.2f", x)
    }

    /** 用户填的地址 → 标准形式 / normalise what the user typed */
    fun normalizeUrl(raw: String): String {
        var u = raw.trim().trimEnd('/')
        if (u.isEmpty()) return ""
        if (!u.startsWith("http://") && !u.startsWith("https://")) {
            val looksLocal = Regex("^(\\d{1,3}\\.){3}\\d{1,3}(:\\d+)?$").matches(u) || u.contains(":")
            u = (if (looksLocal) "http://" else "https://") + u
        }
        u = u.removeSuffix("/mini").removeSuffix("/index.html").trimEnd('/')
        return u
    }
}
