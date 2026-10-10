package io.github.paxonyang.agentcard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelTest {
    private val sample = """
        {"v":1,"now":1000,"lang":"zh","demo":false,
         "session":{"id":"a","project":"web","status":"running","active":true,"task":"给月报加 PDF 导出","taskStartedAt":900,"taskEndedAt":null,
           "model":"Opus 5.5","family":"opus","effort":"high","agentsRunning":2,"agentsDone":1,"bgRunning":1,"now":"Bash · npm test",
           "needMsg":null,"reason":"x","cacheUntil":1601,"gate":"pass","lastEventAt":999},
         "others":[{"project":"docs","status":"idle"}],"needsYou":0,
         "totals":{"cost":2.104,"baseline":5.99,"saved":0.6488,"hours":24,"baselineModel":"opus"}}
    """.trimIndent()

    @Test fun parsesTheBoardPayload() {
        val d = Model.parse(sample)
        val s = d.session!!
        assertEquals("web", s.project)
        assertEquals("Opus 5.5", s.model)
        assertEquals(2, s.agentsRunning)
        assertNull(s.taskEndedAt)
        assertNull(s.needMsg)
        assertEquals(1, d.others.size)
        assertEquals(0.6488, d.totals.saved!!, 1e-9)
        assertEquals(Status.RUNNING, Model.status(s))
        assertTrue(Model.busy(d))
    }

    @Test fun metaTags() {
        val s = Model.parse(sample).session!!
        assertEquals(
            listOf(Meta.Agents(2), Meta.Background(1), Meta.CacheLeft(11), Meta.Gate("pass")),
            Model.meta(s, 1000.0),
        )
        // 缓存过期就不显示 / an expired cache is not shown
        assertEquals(listOf(Meta.Agents(2), Meta.Background(1), Meta.Gate("pass")), Model.meta(s, 1700.0))
    }

    @Test fun statuses() {
        val base = Model.parse(sample).session!!
        assertEquals(Status.NEEDS_YOU, Model.status(base.copy(status = "needs-you")))
        assertEquals(Status.BACKGROUND, Model.status(base.copy(status = "background")))
        assertEquals(Status.IDLE, Model.status(base.copy(status = "idle")))
        assertEquals(Status.ENDED, Model.status(base.copy(active = false)))
        assertEquals(Status.NONE, Model.status(null))
        val idle = Model.parse(sample.replace("\"status\":\"running\"", "\"status\":\"idle\""))
        assertFalse(Model.busy(idle))
    }

    @Test fun emptyBoard() {
        val d = Model.parse("""{"v":1,"now":5,"session":null,"others":[],"needsYou":0,"totals":{"cost":0,"baseline":0,"saved":null,"hours":24,"baselineModel":"opus"}}""")
        assertNull(d.session)
        assertNull(d.totals.saved)
        assertFalse(Model.busy(d))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsOtherJson() {
        Model.parse("""{"sessions":[]}""")
    }

    @Test fun urls() {
        assertEquals("https://board.example.com", Model.normalizeUrl(" board.example.com/ "))
        assertEquals("http://100.64.1.2:4321", Model.normalizeUrl("100.64.1.2:4321"))
        assertEquals("http://mac.tail1234.ts.net:4321", Model.normalizeUrl("mac.tail1234.ts.net:4321"))
        assertEquals("https://board.example.com", Model.normalizeUrl("https://board.example.com/mini"))
        assertEquals("", Model.normalizeUrl("  "))
    }

    @Test fun money() {
        assertEquals("$2.10", Model.money(2.104))
        assertEquals("<$0.01", Model.money(0.001))
        assertEquals("$123", Model.money(123.4))
    }
}
