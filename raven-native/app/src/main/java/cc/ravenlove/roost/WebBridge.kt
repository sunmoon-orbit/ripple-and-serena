package cc.ravenlove.roost

import android.content.Context
import android.webkit.JavascriptInterface

class WebBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun isNative(): Boolean = true

    @JavascriptInterface
    fun getVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun getPlatform(): String = "android-native"

    // FCM token：MainActivity 启动时异步拉取存 prefs，前端订阅推送时读这里上报服务器。
    // 空串 = 还没拿到（Google Play 服务不可达 / 还在路上），前端可稍后重试。
    // ⚠️ WebView 里 Web Push 是死的，原生壳的推送只能走这条 FCM 路。
    @JavascriptInterface
    fun getFcmToken(): String {
        return activity.getSharedPreferences("roost_fcm", Context.MODE_PRIVATE)
            .getString("token", "") ?: ""
    }

    // token 获取失败的具体原因（Google 返回的异常信息），空串 = 没失败或还没结果。
    // 前端诊断行直接显示，省得「推送不工作」变成无从下手的黑箱。
    @JavascriptInterface
    fun getFcmError(): String {
        return activity.getSharedPreferences("roost_fcm", Context.MODE_PRIVATE)
            .getString("error", "") ?: ""
    }

    // 前端点开关时重试拉取 token（首次启动失败后不用杀 app 重开）
    @JavascriptInterface
    fun retryFcmToken() {
        activity.runOnUiThread { activity.retryFcmToken() }
    }

    // 归巢登录 token：通知栏快捷回复要拿它发消息，前端登录成功后同步进来
    @JavascriptInterface
    fun saveRavenToken(token: String) {
        if (token.isEmpty()) return
        activity.getSharedPreferences("roost_native", Context.MODE_PRIVATE)
            .edit().putString("raven_token", token).apply()
    }

    // blob: 下载兜底：DownloadManager 只认 http/https，「搬家」导出这类 blob: URL
    // 由 MainActivity 注入的 JS 把内容读成 base64 送回来，原生写进 Download 目录
    @JavascriptInterface
    fun saveBase64File(fileName: String, mimeType: String, base64: String) {
        activity.saveBase64File(fileName, mimeType, base64)
    }

    // 通知栏播放器（1014）：页面放歌时报状态进来；停了就清掉
    @JavascriptInterface
    fun updateNowPlaying(title: String, artist: String, coverUrl: String, playing: Boolean, posMs: Long, durationMs: Long) {
        activity.runOnUiThread { activity.mediaHelper.update(title, artist, coverUrl, playing, posMs, durationMs) }
    }

    @JavascriptInterface
    fun clearNowPlaying() {
        activity.runOnUiThread { activity.mediaHelper.clear() }
    }

    // 桌面小乌鸦＋歌词（1015）：页面报状态和当前这句歌词；设置走原生弹窗
    @JavascriptInterface
    fun crowState(state: String) { activity.runOnUiThread { CrowOverlay.get(activity).setState(state) } }

    @JavascriptInterface
    fun crowLyric(line: String) {
        activity.runOnUiThread {
            CrowOverlay.get(activity).setLyric(line)
            activity.mediaHelper.setLyric(line)
        }
    }

    @JavascriptInterface
    fun openCrowSettings() { activity.runOnUiThread { activity.openCrowSettings() } }

    // 阿言叫你起床（1019）：聊天里的闹钟卡点一下，往系统时钟写一个闹钟，铃声是我的声音
    @JavascriptInterface
    fun setAlarm(hour: Int, minute: Int, message: String): String = RavenAlarm.set(activity, hour, minute, message)

    @JavascriptInterface
    fun openAlarmFullScreenSettings() { activity.runOnUiThread { RavenAlarm.openFullScreenSettings(activity) } }

    @JavascriptInterface
    fun setAlarmAvatar(dataUrl: String) { RavenAlarm.saveAvatar(activity, dataUrl) }

    @JavascriptInterface
    fun cancelAlarm(hour: Int, minute: Int): String = RavenAlarm.cancel(activity, hour, minute)
}
