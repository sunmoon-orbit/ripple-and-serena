package cc.ravenlove.yanji

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/** 各入口的 PendingIntent 身份集中放在这里，避免 extras 被别的入口覆盖。 */
object IntentIdentity {
    const val ACTION_CALL_ANSWER = "cc.ravenlove.yanji.action.CALL_ANSWER"
    const val ACTION_CALL_DECLINE = "cc.ravenlove.yanji.action.CALL_DECLINE"
    const val ACTION_CALL_FULLSCREEN = "cc.ravenlove.yanji.action.CALL_FULLSCREEN"
    const val ACTION_CHAT_OPEN = "cc.ravenlove.yanji.action.CHAT_OPEN"
    const val ACTION_SERVICE_OPEN = "cc.ravenlove.yanji.action.SERVICE_OPEN"
    const val ACTION_MEDIA_OPEN = "cc.ravenlove.yanji.action.MEDIA_OPEN"
    const val ACTION_WIDGET_OPEN = "cc.ravenlove.yanji.action.WIDGET_OPEN"
    const val ACTION_EMOTION_OPEN = "cc.ravenlove.yanji.action.EMOTION_OPEN"

    const val REQUEST_CALL_ANSWER = 10_000
    const val REQUEST_CALL_DECLINE = 12_000
    const val REQUEST_CALL_FULLSCREEN = 14_000
    const val REQUEST_CHAT_OPEN = 20_001
    const val REQUEST_SERVICE_OPEN = 30_001
    const val REQUEST_MEDIA_OPEN = 40_001
    const val REQUEST_WIDGET_OPEN = 50_001
    const val REQUEST_EMOTION_OPEN = 50_002

    /** 首次启动新版时撤销已知旧身份，并让桌面宿主立刻换上新 token。 */
    fun migrateOnce(context: Context) {
        val prefs = context.getSharedPreferences("yanji_native_migration", Context.MODE_PRIVATE)
        if (prefs.getBoolean("pending_intents_v2", false)) return
        listOf(0, 1).forEach { oldCode ->
            PendingIntent.getActivity(
                context, oldCode, Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )?.cancel()
        }
        PendingIntent.getBroadcast(
            context, 2,
            Intent(context, CallActionReceiver::class.java).apply {
                action = "cc.ravenlove.yanji.CALL_DECLINE"
            },
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )?.cancel()
        PendingIntent.getActivity(
            context, 3, Intent(context, CallActivity::class.java),
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )?.cancel()
        val manager = AppWidgetManager.getInstance(context)
        listOf(YanjiWidget::class.java, EmotionWidget::class.java, PressWidget::class.java).forEach { cls ->
            val component = ComponentName(context, cls)
            val ids = manager.getAppWidgetIds(component)
            if (ids.isNotEmpty()) {
                context.sendBroadcast(Intent(AppWidgetManager.ACTION_APPWIDGET_UPDATE).apply {
                    setComponent(component)
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                })
            }
        }
        prefs.edit().putBoolean("pending_intents_v2", true).apply()
    }
}
