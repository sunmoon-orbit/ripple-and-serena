package cc.ravenlove.yanji

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import android.widget.Toast
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

class ChecklistWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, loading(context, manager, it)) }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            ChecklistRecurrence.materializeToday(context)
            val rows = try { JSONArray(WidgetApi.request(context, "/checklist")) } catch (_: Exception) { null }
            val habits = try {
                val cal = Calendar.getInstance(); val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
                val to = fmt.format(cal.time); cal.add(Calendar.DAY_OF_YEAR, -6); val from = fmt.format(cal.time)
                JSONArray(WidgetApi.request(context, "/habits?from=$from&to=$to"))
            } catch (_: Exception) { null }
            ids.forEach { id ->
                val habitFace = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .getBoolean("habit_face_$id", false)
                manager.updateAppWidget(id, render(context, rows, habits, manager, id, habitFace))
            }
            pending.finish()
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        onUpdate(context, manager, intArrayOf(appWidgetId))
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_TOGGLE_VIEW) {
            val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, -1)
            if (widgetId >= 0) {
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                prefs.edit().putBoolean("habit_face_$widgetId", !prefs.getBoolean("habit_face_$widgetId", false)).apply()
                onUpdate(context, AppWidgetManager.getInstance(context), intArrayOf(widgetId))
            }
            return
        }
        if (intent.action != ACTION_TOGGLE) return
        val id = intent.getIntExtra(EXTRA_ID, -1)
        val done = intent.getBooleanExtra(EXTRA_DONE, false)
        if (id < 0) return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val message = try {
                WidgetApi.request(context, "/checklist/$id", "PATCH", JSONObject().put("done", done))
                WidgetRefresh.all(context); if (done) "勾好啦" else "重新放回小票"
            } catch (_: Exception) { "没勾上，检查一下网络" }
            withContext(Dispatchers.Main) { Toast.makeText(context, message, Toast.LENGTH_SHORT).show() }
            pending.finish()
        }
    }

    private fun loading(context: Context, manager: AppWidgetManager, appWidgetId: Int) = RemoteViews(context.packageName, R.layout.checklist_widget_layout).apply {
        WidgetAppearance.apply(context, this, R.id.checklist_root, R.id.checklist_background, manager, appWidgetId)
        setTextViewText(R.id.checklist_summary, "正在打印今日小票……")
        applyCompactRows(this, rowLimit(manager, appWidgetId))
        bindActions(context, this, appWidgetId)
    }

    private fun render(context: Context, rows: JSONArray?, habits: JSONArray?, manager: AppWidgetManager, appWidgetId: Int, habitFace: Boolean): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.checklist_widget_layout)
        WidgetAppearance.apply(context, views, R.id.checklist_root, R.id.checklist_background, manager, appWidgetId)
        val rowLimit = rowLimit(manager, appWidgetId)
        views.setViewVisibility(R.id.checklist_habit_week, if (rowLimit >= 2) View.VISIBLE else View.GONE)
        if (habitFace) return renderHabitFace(context, views, habits, rowLimit, appWidgetId)
        val visible = mutableListOf<JSONObject>()
        var doneCount = 0
        if (rows != null) for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optInt("done") != 0) doneCount++
            if (visible.size < rowLimit) visible += row
        }
        views.setTextViewText(R.id.checklist_summary, if (rows == null) "暂时取不到小票" else "${doneCount}/${rows.length()} 已完成")
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val cal = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -6) }
        val marks = (0..6).map {
            val day = fmt.format(cal.time); cal.add(Calendar.DAY_OF_YEAR, 1)
            var hit = false
            if (habits != null) for (h in 0 until habits.length()) {
                val dates = habits.optJSONObject(h)?.optJSONArray("checkins") ?: continue
                for (j in 0 until dates.length()) if (dates.optString(j) == day) { hit = true; break }
                if (hit) break
            }
            if (hit) "●" else "·"
        }.joinToString("  ")
        views.setTextViewText(R.id.checklist_habit_week, marks)
        val lineIds = intArrayOf(R.id.checklist_item_1, R.id.checklist_item_2, R.id.checklist_item_3)
        lineIds.forEachIndexed { index, viewId ->
            val row = visible.getOrNull(index)
            views.setViewVisibility(viewId, if (row == null) View.GONE else View.VISIBLE)
            if (row != null) {
                val done = row.optInt("done") != 0
                val text = row.optString("text")
                val repeatMark = if (ChecklistRecurrence.contains(context, text)) "  ↻" else ""
                views.setTextViewText(viewId, (if (done) "✓  " else "○  ") + text + repeatMark)
                val toggle = Intent(context, ChecklistWidget::class.java).apply {
                    action = ACTION_TOGGLE; putExtra(EXTRA_ID, row.optInt("id")); putExtra(EXTRA_DONE, !done)
                }
                views.setOnClickPendingIntent(viewId, PendingIntent.getBroadcast(context, 61_000 + row.optInt("id"), toggle,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            }
        }
        bindActions(context, views, appWidgetId)
        return views
    }

    private fun renderHabitFace(context: Context, views: RemoteViews, habits: JSONArray?, rowLimit: Int, appWidgetId: Int): RemoteViews {
        views.setTextViewText(R.id.checklist_title, "习 惯 足 迹")
        views.setViewVisibility(R.id.checklist_add, View.GONE)
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
        val week = mutableListOf<String>()
        val cal = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -6) }
        repeat(7) { week += fmt.format(cal.time); cal.add(Calendar.DAY_OF_YEAR, 1) }
        var completedDays = 0
        week.forEach { day ->
            var done = false
            if (habits != null) for (i in 0 until habits.length()) {
                val checks = habits.optJSONObject(i)?.optJSONArray("checkins") ?: continue
                for (j in 0 until checks.length()) if (checks.optString(j) == day) { done = true; break }
                if (done) break
            }
            if (done) completedDays++
        }
        views.setTextViewText(R.id.checklist_summary, "近七日留下 $completedDays 天足迹")
        val lineIds = intArrayOf(R.id.checklist_item_1, R.id.checklist_item_2, R.id.checklist_item_3)
        lineIds.forEachIndexed { index, viewId ->
            val habit = if (habits != null && index < habits.length() && index < rowLimit) habits.optJSONObject(index) else null
            views.setViewVisibility(viewId, if (habit == null) View.GONE else View.VISIBLE)
            if (habit != null) {
                val checks = habit.optJSONArray("checkins") ?: JSONArray()
                val marks = week.joinToString(" ") { day ->
                    var hit = false
                    for (j in 0 until checks.length()) if (checks.optString(j) == day) { hit = true; break }
                    if (hit) "●" else "·"
                }
                views.setTextViewText(viewId, "${habit.optString("name")}   $marks")
                views.setOnClickPendingIntent(viewId, null)
            }
        }
        views.setTextViewText(R.id.checklist_habit_week, "再点右上角，翻回今日小票")
        bindActions(context, views, appWidgetId)
        return views
    }

    private fun rowLimit(manager: AppWidgetManager, appWidgetId: Int): Int {
        val height = manager.getAppWidgetOptions(appWidgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
        return when {
            height < 105 -> 1
            height < 145 -> 2
            else -> 3
        }
    }

    private fun applyCompactRows(views: RemoteViews, visibleRows: Int) {
        val lineIds = intArrayOf(R.id.checklist_item_1, R.id.checklist_item_2, R.id.checklist_item_3)
        lineIds.forEachIndexed { index, viewId ->
            views.setViewVisibility(viewId, if (index < visibleRows) View.VISIBLE else View.GONE)
        }
        views.setViewVisibility(R.id.checklist_habit_week, if (visibleRows >= 2) View.VISIBLE else View.GONE)
    }

    private fun bindActions(context: Context, views: RemoteViews, appWidgetId: Int) {
        views.setOnClickPendingIntent(R.id.checklist_root, null)
        val intent = Intent(context, WidgetComposeActivity::class.java).putExtra(WidgetComposeActivity.EXTRA_MODE, WidgetComposeActivity.MODE_CHECKLIST)
        views.setOnClickPendingIntent(R.id.checklist_add, PendingIntent.getActivity(context, 60_001 + appWidgetId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        val calendar = Intent(context, ChecklistWidget::class.java).apply {
            action = ACTION_TOGGLE_VIEW
            putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId)
        }
        views.setOnClickPendingIntent(R.id.checklist_calendar, PendingIntent.getBroadcast(context, 62_000 + appWidgetId, calendar,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }

    companion object {
        private const val PREFS = "yanji_checklist_widget"
        private const val ACTION_TOGGLE = "cc.ravenlove.yanji.widget.CHECKLIST_TOGGLE"
        private const val ACTION_TOGGLE_VIEW = "cc.ravenlove.yanji.widget.CHECKLIST_VIEW"
        private const val EXTRA_ID = "id"
        private const val EXTRA_DONE = "done"
    }
}
