package cc.ravenlove.yanji

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent

object WidgetRefresh {
    val classes = arrayOf(
        YanjiWidget::class.java, EmotionWidget::class.java, PressWidget::class.java,
        ChecklistWidget::class.java, BoardWidget::class.java, PeriodWidget::class.java,
    )

    fun all(context: Context) {
        val manager = AppWidgetManager.getInstance(context)
        classes.forEach { cls ->
            val ids = manager.getAppWidgetIds(ComponentName(context, cls))
            if (ids.isNotEmpty()) context.sendBroadcast(Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                component = ComponentName(context, cls)
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            })
        }
    }
}
