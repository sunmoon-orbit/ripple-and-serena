package cc.ravenlove.yanji

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.app.PendingIntent
import android.os.Bundle
import android.widget.RemoteViews
import kotlinx.coroutines.*
import org.json.JSONObject

class PeriodWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, render(context, null)) }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val data = try { JSONObject(WidgetApi.request(context, "/period")) } catch (_: Exception) { null }
            ids.forEach { manager.updateAppWidget(it, render(context, data)) }
            pending.finish()
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        onUpdate(context, manager, intArrayOf(appWidgetId))
    }

    private fun render(context: Context, data: JSONObject?): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.period_widget_layout)
        WidgetAppearance.apply(context, views, R.id.period_root, R.id.period_background)
        val stats = data?.optJSONObject("stats")
        val logs = data?.optJSONArray("logs")
        var ongoing = false
        if (logs != null) for (i in 0 until logs.length()) if (logs.optJSONObject(i)?.optString("end_date").isNullOrEmpty()) ongoing = true
        val day = stats?.optInt("day_of_cycle", 0) ?: 0
        val next = stats?.optString("predicted_next", "").orEmpty()
        val delta = stats?.optInt("delta_days", Int.MIN_VALUE) ?: Int.MIN_VALUE
        val status = when {
            data == null -> "翻月历中……"
            ongoing && day > 0 -> "经期第 $day 天 · 进行中"
            next.isNotEmpty() && delta > 0 -> "预计 ${next.takeLast(5).replace('-', '/')} · 晚了 $delta 天"
            next.isNotEmpty() && delta != Int.MIN_VALUE && delta <= 0 -> "预计 ${next.takeLast(5).replace('-', '/')} · 还有 ${-delta} 天"
            next.isNotEmpty() -> "预计下次 ${next.takeLast(5).replace('-', '/')}"
            else -> "再记一次，就能算出预测"
        }
        views.setTextViewText(R.id.period_status, status)
        views.setTextViewText(R.id.period_cycle, stats?.optInt("avg_cycle", 0)?.takeIf { it > 0 }?.let { "平均周期 $it 天" } ?: "周期记录")
        val open = Intent(context, MainActivity::class.java).apply { action = IntentIdentity.ACTION_WIDGET_OPEN }
        views.setOnClickPendingIntent(R.id.period_root, PendingIntent.getActivity(context, 60_004, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        return views
    }
}
