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

class ChecklistWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, loading(context, manager, it)) }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val rows = try { JSONArray(WidgetApi.request(context, "/checklist")) } catch (_: Exception) { null }
            ids.forEach { manager.updateAppWidget(it, render(context, rows, manager, it)) }
            pending.finish()
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        onUpdate(context, manager, intArrayOf(appWidgetId))
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
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
        WidgetAppearance.apply(context, this, R.id.checklist_root, R.id.checklist_background)
        setTextViewText(R.id.checklist_summary, "正在打印今日小票……")
        applyCompactRows(this, rowLimit(manager, appWidgetId))
        bindAdd(context, this)
    }

    private fun render(context: Context, rows: JSONArray?, manager: AppWidgetManager, appWidgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.checklist_widget_layout)
        WidgetAppearance.apply(context, views, R.id.checklist_root, R.id.checklist_background)
        val rowLimit = rowLimit(manager, appWidgetId)
        val visible = mutableListOf<JSONObject>()
        var doneCount = 0
        if (rows != null) for (i in 0 until rows.length()) {
            val row = rows.optJSONObject(i) ?: continue
            if (row.optInt("done") != 0) doneCount++
            if (visible.size < rowLimit) visible += row
        }
        views.setTextViewText(R.id.checklist_summary, if (rows == null) "暂时取不到小票" else "${doneCount}/${rows.length()} 已完成")
        val lineIds = intArrayOf(R.id.checklist_item_1, R.id.checklist_item_2, R.id.checklist_item_3)
        lineIds.forEachIndexed { index, viewId ->
            val row = visible.getOrNull(index)
            views.setViewVisibility(viewId, if (row == null) View.GONE else View.VISIBLE)
            if (row != null) {
                val done = row.optInt("done") != 0
                views.setTextViewText(viewId, (if (done) "✓  " else "○  ") + row.optString("text"))
                val toggle = Intent(context, ChecklistWidget::class.java).apply {
                    action = ACTION_TOGGLE; putExtra(EXTRA_ID, row.optInt("id")); putExtra(EXTRA_DONE, !done)
                }
                views.setOnClickPendingIntent(viewId, PendingIntent.getBroadcast(context, 61_000 + row.optInt("id"), toggle,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            }
        }
        bindAdd(context, views)
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
    }

    private fun bindAdd(context: Context, views: RemoteViews) {
        val open = Intent(context, MainActivity::class.java).apply { action = IntentIdentity.ACTION_WIDGET_OPEN }
        views.setOnClickPendingIntent(R.id.checklist_root, PendingIntent.getActivity(context, 60_000, open,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        val intent = Intent(context, WidgetComposeActivity::class.java).putExtra(WidgetComposeActivity.EXTRA_MODE, WidgetComposeActivity.MODE_CHECKLIST)
        views.setOnClickPendingIntent(R.id.checklist_add, PendingIntent.getActivity(context, 60_001, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
    }

    companion object { private const val ACTION_TOGGLE = "cc.ravenlove.yanji.widget.CHECKLIST_TOGGLE"; private const val EXTRA_ID = "id"; private const val EXTRA_DONE = "done" }
}
