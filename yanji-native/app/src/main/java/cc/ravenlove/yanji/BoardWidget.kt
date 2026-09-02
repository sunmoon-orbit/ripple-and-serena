package cc.ravenlove.yanji

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.RemoteViews
import kotlinx.coroutines.*
import org.json.JSONArray

class BoardWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { manager.updateAppWidget(it, render(context, null, manager, it)) }
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            val note = try { JSONArray(WidgetApi.request(context, "/board?limit=1")).optJSONObject(0) } catch (_: Exception) { null }
            ids.forEach { manager.updateAppWidget(it, render(context, note?.let { it.optString("text") to it.optString("author") }, manager, it)) }
            pending.finish()
        }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        onUpdate(context, manager, intArrayOf(appWidgetId))
    }

    private fun render(context: Context, note: Pair<String, String>?, manager: AppWidgetManager, appWidgetId: Int): RemoteViews =
        RemoteViews(context.packageName, R.layout.board_widget_layout).apply {
            WidgetAppearance.apply(context, this, R.id.board_root, R.id.board_background, manager, appWidgetId)
            setTextViewText(R.id.board_text, note?.first ?: "留一句话在这里……")
            setTextViewText(R.id.board_author, note?.second?.let { "— $it" } ?: "")
            val height = manager.getAppWidgetOptions(appWidgetId).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
            setInt(R.id.board_text, "setMaxLines", when { height < 105 -> 1; height < 145 -> 2; else -> 4 })
            val open = Intent(context, MainActivity::class.java).apply { action = IntentIdentity.ACTION_WIDGET_OPEN }
            setOnClickPendingIntent(R.id.board_root, PendingIntent.getActivity(context, 60_003, open,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            val add = Intent(context, WidgetComposeActivity::class.java).putExtra(WidgetComposeActivity.EXTRA_MODE, WidgetComposeActivity.MODE_BOARD)
            setOnClickPendingIntent(R.id.board_add, PendingIntent.getActivity(context, 60_002, add,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        }
}
