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

    // 给页面一个「喊一声」的口子。通知栏快捷回复这条路上有好几段只有页面自己知道
    // 走没走到（注入的 JS 有没有等到函数、handleSend 有没有真发出去），
    // 出问题时全是静默的——0726 靠日志猜了三轮都没猜中。有灯才好修。
    @JavascriptInterface
    fun toast(msg: String) {
        if (msg.isEmpty()) return
        activity.runOnUiThread {
            android.widget.Toast.makeText(activity, msg, android.widget.Toast.LENGTH_LONG).show()
        }
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

    // 拾羽记忆库 token：想你键小组件发 /press 用（她打开言叽时前端同步进来）。
    // ⚠️ 这个 key 必须真有人写。0726 删掉的 QuickReplyReceiver 就是读了一个
    //    从来没人写过的 raven_token，读到空串照发不误，错得悄无声息。
    @JavascriptInterface
    fun saveMoonToken(token: String) {
        if (token.isEmpty()) return
        activity.getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
            .edit()
            .putString("moon_token", token)
            .apply()
    }

    // blob: 下载兜底：DownloadManager 只认 http/https，备份导出这类 blob: URL
    // 由 MainActivity 注入的 JS 把内容读成 base64 送回来，原生写进 Download 目录（0723）
    @JavascriptInterface
    fun saveBase64File(fileName: String, mimeType: String, base64: String) {
        activity.saveBase64File(fileName, mimeType, base64)
    }

    @JavascriptInterface
    fun updateNowPlaying(title: String, artist: String, coverUrl: String, playing: Boolean, posMs: Long, durationMs: Long) {
        activity.runOnUiThread {
            activity.mediaHelper.update(title, artist, coverUrl, playing, posMs, durationMs)
        }
    }

    @JavascriptInterface
    fun clearNowPlaying() {
        activity.runOnUiThread { activity.mediaHelper.clear() }
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
        for (cls in arrayOf(YanjiWidget::class.java, EmotionWidget::class.java, PressWidget::class.java)) {
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
