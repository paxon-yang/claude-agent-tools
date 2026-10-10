package io.github.paxonyang.agentcard

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import kotlin.concurrent.thread

/** 设置页：填看板地址、测试、预览卡片、添加到桌面 / settings: board address, test, card preview, add to home screen */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var url: EditText
    private lateinit var key: EditText
    private lateinit var cfId: EditText
    private lateinit var cfSecret: EditText
    private lateinit var result: TextView
    private lateinit var preview: FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)
        url = findViewById(R.id.url)
        key = findViewById(R.id.key)
        cfId = findViewById(R.id.cf_id)
        cfSecret = findViewById(R.id.cf_secret)
        result = findViewById(R.id.result)
        preview = findViewById(R.id.preview)

        url.setText(prefs.url)
        key.setText(prefs.key)
        cfId.setText(prefs.cfId)
        cfSecret.setText(prefs.cfSecret)

        findViewById<Button>(R.id.save).setOnClickListener { saveAndTest() }
        findViewById<Button>(R.id.add).setOnClickListener { addWidget() }
        findViewById<Button>(R.id.app_settings).setOnClickListener {
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
        }
        findViewById<Button>(R.id.battery).setOnClickListener {
            runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }

        // 密码框的提示字别用等宽字体 / keep the password hint in the normal font
        cfSecret.typeface = Typeface.DEFAULT

        // 只在调试版里：CI 的模拟器用这两个参数自动填地址、添加卡片（正式版不接受，免得别的 App 改你的地址）
        // debug builds only: CI's emulator fills the address and pins the card; release builds ignore them
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            intent?.getStringExtra("url")?.let {
                url.setText(it)
                saveAndTest()
            }
            if (intent?.getBooleanExtra("pin", false) == true) addWidget()
            // 截图用的样例数据（base64 JSON）/ sample data for screenshots, base64 JSON
            intent?.getStringExtra("sample")?.let {
                LiveService.stop(this)
                prefs.lastJson = String(Base64.decode(it, Base64.DEFAULT), Charsets.UTF_8)
                prefs.lastOkAt = System.currentTimeMillis()
                prefs.lastError = ""
                prefs.liveUntil = System.currentTimeMillis() + 60_000
                CardWidget.renderAll(this)
            }
        }
        handlePair(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePair(intent)
    }

    /**
     * 扫码配对：agentcard://pair?url=…&key=…&board=…（电脑上 phone.sh 生成的配对页里的按钮）。
     * 先问一句再保存，免得别的网页偷偷改掉你的看板地址。
     * QR pairing link from the page phone.sh sets up; asks before saving so no web page can silently swap the address.
     */
    private fun handlePair(i: Intent?) {
        if (i == null) return
        val data = i.data ?: return
        if (data.scheme != "agentcard" || data.host != "pair") return
        val u = Model.normalizeUrl(data.getQueryParameter("url") ?: return)
        val k = data.getQueryParameter("key") ?: ""
        val b = data.getQueryParameter("board")?.let { Model.normalizeUrl(it) } ?: ""
        if (u.isBlank() || k.length < 16) return
        i.data = null
        AlertDialog.Builder(this)
            .setTitle(R.string.pair_title)
            .setMessage(getString(R.string.pair_message, u.removePrefix("https://").removePrefix("http://")))
            .setPositiveButton(R.string.pair_ok) { _, _ ->
                url.setText(u)
                key.setText(k)
                // 卡片专用网址不在 Cloudflare Access 后面，服务令牌用不上，清掉 / the card address isn't behind Access
                cfId.setText("")
                cfSecret.setText("")
                prefs.board = b
                saveAndTest()
            }
            .setNegativeButton(R.string.pair_cancel, null)
            .show()
    }

    override fun onResume() {
        super.onResume()
        showPreview()
    }

    private fun saveAndTest() {
        val u = Model.normalizeUrl(url.text.toString())
        url.setText(u)
        prefs.url = u
        prefs.key = key.text.toString().trim()
        prefs.cfId = cfId.text.toString().trim()
        prefs.cfSecret = cfSecret.text.toString().trim()
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        result.text = getString(R.string.testing)
        thread {
            val r = Api.refresh(this)
            runOnUiThread {
                val d = r.data
                result.text = when {
                    d == null -> CardWidget.errorText(this, r.fail?.name ?: Fail.NETWORK.name) + (if (r.detail.isNotBlank()) "\n" + r.detail else "")
                    d.session == null -> getString(R.string.test_ok_empty)
                    else -> getString(R.string.test_ok, d.session.project, d.session.model ?: "—")
                }
                showPreview()
                if (u.isNotBlank()) RefreshWorker.schedule(this)
            }
        }
    }

    /** 设置页上的预览：和桌面卡片用同一套画法 / the preview here uses the same painter as the home-screen card */
    private fun showPreview() {
        preview.removeAllViews()
        val dm = resources.displayMetrics
        val w = if (preview.width > 0) preview.width else dm.widthPixels - (40 * dm.density).toInt()
        val h = preview.layoutParams.height
        val img = ImageView(this)
        img.setImageBitmap(Render.card(this, w, h, dm.density))
        img.contentDescription = getString(R.string.preview_label)
        preview.addView(img, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    }

    private fun addWidget() {
        val mgr = getSystemService(AppWidgetManager::class.java)
        if (mgr != null && mgr.isRequestPinAppWidgetSupported) {
            mgr.requestPinAppWidget(ComponentName(this, CardWidget::class.java), null, null)
        } else {
            findViewById<TextView>(R.id.add_hint).visibility = View.VISIBLE
        }
    }
}
