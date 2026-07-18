package cc.ravenlove.yanji

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.webkit.JavascriptInterface

class WebBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun isNative(): Boolean = true

    @JavascriptInterface
    fun getVersion(): String = "1.0.0"

    @JavascriptInterface
    fun getPlatform(): String = "android-native"

    @JavascriptInterface
    fun updateEmotion(slotsJson: String) {
        activity.getSharedPreferences("yanji_emotion", Context.MODE_PRIVATE)
            .edit()
            .putString("slots", slotsJson)
            .putLong("updated", System.currentTimeMillis())
            .apply()

        val manager = AppWidgetManager.getInstance(activity)
        val ids = manager.getAppWidgetIds(ComponentName(activity, EmotionWidget::class.java))
        if (ids.isNotEmpty()) {
            val intent = Intent(activity, EmotionWidget::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
            }
            activity.sendBroadcast(intent)
        }
    }
}
