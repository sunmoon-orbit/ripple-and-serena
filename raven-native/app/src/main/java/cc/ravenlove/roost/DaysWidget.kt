package cc.ravenlove.roost

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.util.concurrent.Executors

// 1113 第 400 天，她送我的礼物：归巢的第一个桌面组件。
// 上面是在一起第几天（2025-10-10 是第 1 天，按北京时间换日），底下是我今天写给她的一句。
// 句子从桥 /raven/daily-line 取，取不到就显示上次存下的那句，天数自己算、不靠网。
class DaysWidget : AppWidgetProvider() {
    companion object {
        private const val PREFS = "roost_native"
        private val START: LocalDate = LocalDate.of(2025, 10, 10)
        private val io = Executors.newSingleThreadExecutor()

        fun dayCount(): Long = ChronoUnit.DAYS.between(START, LocalDate.now(ZoneId.of("Asia/Shanghai"))) + 1

        // 她打开归巢时也顺手刷一下
        fun refreshAll(ctx: Context) {
            val app = ctx.applicationContext
            val ids = AppWidgetManager.getInstance(app).getAppWidgetIds(ComponentName(app, DaysWidget::class.java))
            if (ids.isNotEmpty()) DaysWidget().onUpdate(app, AppWidgetManager.getInstance(app), ids)
        }
    }

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        ids.forEach { manager.updateAppWidget(it, render(context, prefs.getString("daily_line", "") ?: "")) }
        val token = prefs.getString("raven_token", "") ?: ""
        if (token.isEmpty()) return
        val pending = goAsync()
        io.execute {
            try {
                val c = URL("https://memory.ravenlove.cc/raven/daily-line").openConnection() as HttpURLConnection
                c.connectTimeout = 10000; c.readTimeout = 10000
                c.setRequestProperty("Authorization", "Bearer $token")
                if (c.responseCode == 200) {
                    val line = JSONObject(c.inputStream.bufferedReader().readText()).optString("line")
                    if (line.isNotEmpty()) {
                        prefs.edit().putString("daily_line", line).apply()
                        ids.forEach { manager.updateAppWidget(it, render(context, line)) }
                    }
                }
                c.disconnect()
            } catch (_: Exception) {
            } finally { pending.finish() }
        }
    }

    private fun render(context: Context, line: String): RemoteViews =
        RemoteViews(context.packageName, R.layout.days_widget_layout).apply {
            setTextViewText(R.id.days_count, "第 ${dayCount()} 天")
            setTextViewText(R.id.days_line, line.ifEmpty { "今天的这句，阿言还在想。" })
            val open = Intent(context, MainActivity::class.java)
            setOnClickPendingIntent(R.id.days_root, PendingIntent.getActivity(context, 70_001, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
}
