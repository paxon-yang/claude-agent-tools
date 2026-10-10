package io.github.paxonyang.agentcard

import android.Manifest
import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.TextView
import kotlin.concurrent.thread

/** 设置页：填看板地址、测试、预览卡片、添加到桌面 / settings: board address, test, card preview, add to home screen */
class MainActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var url: EditText
    private lateinit var cfId: EditText
    private lateinit var cfSecret: EditText
    private lateinit var result: TextView
    private lateinit var preview: FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        prefs = Prefs(this)
        url = findViewById(R.id.url)
        cfId = findViewById(R.id.cf_id)
        cfSecret = findViewById(R.id.cf_secret)
        result = findViewById(R.id.result)
        preview = findViewById(R.id.preview)

        url.setText(prefs.url)
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

        // 测试用：adb shell am start -n …/.MainActivity --es url http://10.0.2.2:4330
        intent?.getStringExtra("url")?.let {
            url.setText(it)
            saveAndTest()
        }
    }

    override fun onResume() {
        super.onResume()
        showPreview()
    }

    private fun saveAndTest() {
        val u = Model.normalizeUrl(url.text.toString())
        url.setText(u)
        prefs.url = u
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

    private fun showPreview() {
        preview.removeAllViews()
        val v: View = CardWidget.build(this).apply(this, preview)
        preview.addView(v, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
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
