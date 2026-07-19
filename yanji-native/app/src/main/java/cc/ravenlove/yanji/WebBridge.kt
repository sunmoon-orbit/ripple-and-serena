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

    // FCM token：MainActivity 启动时异步拉取存 prefs，前端订阅推送时读这里。
    // 空串=还没拿到（Google Play 服务不可达/还在路上），前端可稍后重试。
    @JavascriptInterface
    fun getFcmToken(): String {
        return activity.getSharedPreferences("yanji_fcm", Context.MODE_PRIVATE)
            .getString("token", "") ?: ""
    }

    // token 获取失败时的具体原因（Google 返回的异常信息），空串=没失败或还没结果
    @JavascriptInterface
    fun getFcmError(): String {
        return activity.getSharedPreferences("yanji_fcm", Context.MODE_PRIVATE)
            .getString("error", "") ?: ""
    }

    // 前端点开关时重试拉取 token（首次启动失败后不用杀 app 重开）
    @JavascriptInterface
    fun retryFcmToken() {
        activity.runOnUiThread { activity.retryFcmToken() }
    }

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

    @JavascriptInterface
    fun updateTheme(themeId: String) {
        activity.getSharedPreferences("yanji_theme", Context.MODE_PRIVATE)
            .edit()
            .putString("theme", themeId)
            .apply()

        refreshAllWidgets()
    }

    private fun refreshAllWidgets() {
        val manager = AppWidgetManager.getInstance(activity)
        for (cls in arrayOf(YanjiWidget::class.java, EmotionWidget::class.java)) {
            val ids = manager.getAppWidgetIds(ComponentName(activity, cls))
            if (ids.isNotEmpty()) {
                val intent = Intent(activity, cls).apply {
                    action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
                    putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids)
                }
                activity.sendBroadcast(intent)
            }
        }
    }
}
