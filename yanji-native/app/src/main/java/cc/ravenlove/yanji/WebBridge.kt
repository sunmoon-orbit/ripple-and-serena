package cc.ravenlove.yanji

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import java.io.File
import java.util.concurrent.Executors

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

    // 前端推送开关的原生镜像。Firebase 在 WebView 关闭时轮换 token，原生端只有
    // 知道她确实开着推送，才可以自行补传；关闭后绝不偷偷重新订阅。
    @JavascriptInterface
    fun setFcmEnabled(enabled: Boolean) {
        NativeFcmTokenSync.setEnabled(activity, enabled)
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
        NativeCallActionQueue.flush(activity)
    }

    // 新壳同步 token 时同时带上它所属的 HTTPS 后端，避免把自定义后端凭据送往默认主机。
    @JavascriptInterface
    fun saveMoonConnection(baseUrl: String, token: String) {
        val normalizedBaseUrl = NativeMoonEndpoint.normalize(baseUrl) ?: return
        if (token.isEmpty()) return
        activity.getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
            .edit()
            .putString("moon_base_url", normalizedBaseUrl)
            .putString("moon_token", token)
            .apply()
        NativeCallActionQueue.flush(activity)
        NativeFcmTokenSync.flush(activity)
    }

    // 铃声选择存在网页端的 localStorage 里，锁屏来电的 CallActivity 读不到——
    // 所以设置页每次改铃声都往这儿抄一份，原生端只认 yanji_native/ringtone。
    // 上面 saveMoonToken 的教训反过来同样成立：这个 key 必须真有人读（CallActivity.startRinging）。
    @JavascriptInterface
    fun saveRingtone(id: String) {
        if (id.isEmpty()) return
        activity.getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
            .edit()
            .putString("ringtone", id)
            .apply()
    }

    // 来电页必须在 WebView 起来前就能读到头像，所以网页端把设置里的头像抄到 filesDir。
    // 解码和落盘都放在线程里；先写临时文件再 rename，来电页不会撞见半张图。
    @JavascriptInterface
    fun saveCallAvatar(base64: String) {
        avatarWriter.execute {
            val target = File(activity.filesDir, "call_avatar.png")
            val temporary = File(activity.filesDir, "call_avatar.png.tmp")
            try {
                if (base64.isEmpty()) {
                    if (temporary.exists() && !temporary.delete()) {
                        Log.w("YanjiCall", "清理来电头像临时文件失败")
                    }
                    if (target.exists() && !target.delete()) {
                        Log.w("YanjiCall", "清除来电头像失败")
                    }
                    return@execute
                }

                // 正常约定是裸 base64；也兼容误传的 data:image/...;base64, 前缀。
                val payload = base64.substringAfter(',', base64)
                if (payload.length > MAX_CALL_AVATAR_BASE64_CHARS) {
                    Log.w("YanjiCall", "来电头像 base64 超过 4MB，已忽略")
                    return@execute
                }
                val bytes = Base64.decode(payload, Base64.DEFAULT)
                temporary.outputStream().use { output ->
                    output.write(bytes)
                    output.flush()
                    // 写成 getFD() 而不是 .fd：全大写的 Java getter 转 Kotlin 属性名有歧义，
                    // 这边没有编译器，猜错的代价是一整轮 CI，用方法调用最稳。
                    output.getFD().sync()
                }
                if (!temporary.renameTo(target)) {
                    Log.w("YanjiCall", "来电头像临时文件替换失败")
                    temporary.delete()
                }
            } catch (e: Exception) {
                Log.w("YanjiCall", "保存来电头像失败，保留原头像", e)
                temporary.delete()
            } catch (e: OutOfMemoryError) {
                Log.w("YanjiCall", "来电头像解码内存不足，已忽略")
                temporary.delete()
            }
        }
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

    @JavascriptInterface
    fun updateWidgetBackgroundStyle(style: String) {
        val safeStyle = if (style == "translucent" || style == "image") style else "solid"
        activity.getSharedPreferences("yanji_theme", Context.MODE_PRIVATE)
            .edit()
            .putString("widget_background_style", safeStyle)
            .apply()

        refreshAllWidgets()
    }

    @JavascriptInterface
    fun saveWidgetBackground(base64: String) {
        avatarWriter.execute {
            try {
                val target = File(activity.filesDir, "widget_background.jpg")
                if (base64.isEmpty()) target.delete()
                else {
                    val bytes = Base64.decode(base64.substringAfter(',', base64), Base64.DEFAULT)
                    if (bytes.size <= 3 * 1024 * 1024) target.writeBytes(bytes)
                }
                activity.runOnUiThread { refreshAllWidgets() }
            } catch (e: Exception) { Log.w("YanjiWidget", "保存组件底图失败", e) }
        }
    }

    private fun refreshAllWidgets() {
        WidgetRefresh.all(activity)
    }

    companion object {
        private const val MAX_CALL_AVATAR_BASE64_CHARS = 4 * 1024 * 1024
        private val avatarWriter = Executors.newSingleThreadExecutor()
    }
}
