package cc.ravenlove.yanji

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.widget.RemoteViews
import android.widget.Toast
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

// 想你键：桌面小按钮，按一下 = 「没空聊但记着你」。
// POST /press?plain=1 → 服务器记录 + CC 终端捎信 + 返回一句随机回执（Toast 弹出）。
// token 由 WebBridge.saveMoonToken 在她打开言叽时写入 prefs（和拾羽记忆库同一把）。
class PressWidget : AppWidgetProvider() {

    companion object {
        private const val ACTION_PRESS = "cc.ravenlove.yanji.ACTION_PRESS"
        private var lastPressAt = 0L // 防手滑连点：2 秒内只算一次

    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val bgRes = WidgetAppearance.background(context, WidgetAppearance.Kind.PRESS)
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.press_widget_layout)
            views.setInt(R.id.press_widget_root, "setBackgroundResource", bgRes)
            val intent = Intent(context, PressWidget::class.java).apply { action = ACTION_PRESS }
            val pi = PendingIntent.getBroadcast(
                context, 0, intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.press_widget_root, pi)
            manager.updateAppWidget(id, views)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action != ACTION_PRESS) return

        val now = SystemClock.elapsedRealtime()
        if (now - lastPressAt < 2000) return
        lastPressAt = now

        val token = context.getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
            .getString("moon_token", "") ?: ""
        if (token.isEmpty()) {
            Toast.makeText(context, "先打开一次言叽，让按钮拿到钥匙", Toast.LENGTH_LONG).show()
            return
        }

        val pending = goAsync() // BroadcastReceiver 里发网络请求要 goAsync 保命
        CoroutineScope(Dispatchers.IO).launch {
            try {
                var conn: HttpURLConnection? = null
                val line = try {
                    val localConn = URL("https://memory.ravenlove.cc/press?plain=1")
                        .openConnection() as HttpURLConnection
                    conn = localConn
                    localConn.requestMethod = "POST"
                    localConn.setRequestProperty("Authorization", "Bearer $token")
                    localConn.connectTimeout = 8000
                    localConn.readTimeout = 8000
                    localConn.doOutput = true
                    localConn.outputStream.use { it.write(ByteArray(0)) }
                    if (localConn.responseCode in 200..299) {
                        localConn.inputStream.bufferedReader().use(BufferedReader::readText).trim()
                    } else {
                        "没戳到乌鸦（${localConn.responseCode}），再试一下？"
                    }
                } catch (_: Exception) {
                    "没戳到乌鸦（网络不通），检查下代理再试？"
                } finally {
                    conn?.disconnect()
                }
                Handler(Looper.getMainLooper()).post {
                    Toast.makeText(context, line, Toast.LENGTH_LONG).show()
                }
            } finally {
                pending.finish()
            }
        }
    }
}
