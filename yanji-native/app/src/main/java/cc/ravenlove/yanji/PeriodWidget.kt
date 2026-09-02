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
        ids.forEach { manager.updateAppWidget(it, render(context, null, manager, it)) }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val data = try { JSONObject(WidgetApi.request(context, "/period")) } catch (_: Exception) { null }
            ids.forEach { manager.updateAppWidget(it, render(context, data, manager, it)) }
            pending.finish()
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        onUpdate(context, manager, intArrayOf(appWidgetId))
    }

    private fun render(context: Context, data: JSONObject?, manager: AppWidgetManager, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.period_widget_layout)
        WidgetAppearance.apply(context, views, R.id.period_root, R.id.period_background, manager, appWidgetId)
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

        val options = manager.getAppWidgetOptions(appWidgetId)
        val expanded = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0) >= 220 &&
            options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0) >= 170
        views.setViewVisibility(R.id.period_compact, if (expanded) android.view.View.GONE else android.view.View.VISIBLE)
        views.setViewVisibility(R.id.period_expanded, if (expanded) android.view.View.VISIBLE else android.view.View.GONE)
        if (expanded) {
            val avgCycle = stats?.optInt("avg_cycle", 0) ?: 0
            val avgDuration = stats?.optInt("avg_duration", 0) ?: 0
            val today = stats?.optString("today", "").orEmpty().takeLast(5).replace('-', '/')
            val countdown = when {
                data == null -> "…"
                ongoing && day > 0 -> "第 $day 天"
                delta != Int.MIN_VALUE && delta > 0 -> "$delta 天"
                delta != Int.MIN_VALUE -> "${-delta} 天"
                else -> "--"
            }
            val countdownLabel = when {
                data == null -> "正在翻月历"
                ongoing -> "经期进行中"
                delta > 0 -> "比预计日期晚"
                next.isNotEmpty() -> "距离预计日期 · ${next.takeLast(5).replace('-', '/')}"
                else -> "等待更多周期记录"
            }
            val progressBase = if (ongoing && avgDuration > 0) avgDuration else avgCycle
            val progress = if (progressBase > 0 && day > 0) (day * 100 / progressBase).coerceIn(4, 100) else 0
            views.setTextViewText(R.id.period_expanded_date, today)
            views.setTextViewText(R.id.period_countdown, countdown)
            views.setTextViewText(R.id.period_countdown_label, countdownLabel)
            views.setTextViewText(R.id.period_expanded_status, status)
            views.setTextViewText(R.id.period_day_value, day.takeIf { it > 0 }?.let { "$it 天" } ?: "--")
            views.setTextViewText(R.id.period_avg_cycle_value, avgCycle.takeIf { it > 0 }?.let { "$it 天" } ?: "--")
            views.setTextViewText(R.id.period_avg_duration_value, avgDuration.takeIf { it > 0 }?.let { "$it 天" } ?: "--")
            views.setProgressBar(R.id.period_progress, 100, progress, false)
        }
        val open = Intent(context, MainActivity::class.java).apply { action = IntentIdentity.ACTION_WIDGET_OPEN }
        views.setOnClickPendingIntent(R.id.period_root, PendingIntent.getActivity(context, 60_004, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        return views
    }
}
