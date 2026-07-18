package cc.ravenlove.yanji

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import kotlinx.coroutines.*
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class YanjiWidget : AppWidgetProvider() {

    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        val prefs = context.getSharedPreferences("yanji_widget", Context.MODE_PRIVATE)

        for (id in ids) {
            val views = buildViews(context, prefs)
            manager.updateAppWidget(id, views)
        }

        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val json = fetchDaily() ?: return@launch
                val days = "在一起第 ${json.getInt("days_together")} 天"
                val date = json.getString("date").replace("-", ".")
                val level = "今日${json.getString("level")}"
                val yi = json.getJSONArray("yi")
                val detail = buildString {
                    append("宜 ")
                    for (i in 0 until minOf(2, yi.length())) {
                        if (i > 0) append(" · ")
                        append(yi.getString(i))
                    }
                    append("  ✦ ")
                    append(json.getString("lucky"))
                }

                prefs.edit()
                    .putString("days", days)
                    .putString("date", date)
                    .putString("level", level)
                    .putString("detail", detail)
                    .apply()

                withContext(Dispatchers.Main) {
                    for (id in ids) {
                        manager.updateAppWidget(id, buildViews(context, prefs))
                    }
                }
            } catch (_: Exception) {
            } finally {
                pending.finish()
            }
        }
    }

    private fun buildViews(context: Context, prefs: android.content.SharedPreferences): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_layout)

        views.setTextViewText(R.id.widget_days, prefs.getString("days", "言叽") ?: "言叽")
        views.setTextViewText(R.id.widget_date, prefs.getString("date", "") ?: "")
        views.setTextViewText(R.id.widget_level, prefs.getString("level", "") ?: "")
        views.setTextViewText(R.id.widget_detail, prefs.getString("detail", "") ?: "")

        val intent = Intent(context, MainActivity::class.java)
        val pi = PendingIntent.getActivity(
            context, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        views.setOnClickPendingIntent(R.id.widget_root, pi)

        return views
    }

    private fun fetchDaily(): JSONObject? {
        return try {
            val conn = URL("https://memory.ravenlove.cc/widget/daily")
                .openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            val text = conn.inputStream.bufferedReader().readText()
            conn.disconnect()
            JSONObject(text)
        } catch (_: Exception) {
            null
        }
    }
}
