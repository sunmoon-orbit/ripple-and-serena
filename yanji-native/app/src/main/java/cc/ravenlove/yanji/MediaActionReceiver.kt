package cc.ravenlove.yanji

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class MediaActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = when (intent.action) {
            MediaNotificationHelper.ACTION_PLAY -> "play"
            MediaNotificationHelper.ACTION_PAUSE -> "pause"
            MediaNotificationHelper.ACTION_STOP -> "stop"
            MediaNotificationHelper.ACTION_NEXT -> "next"
            MediaNotificationHelper.ACTION_PREV -> "prev"
            else -> return
        }
        // 转发给 MainActivity，由它回调 WebView JS
        val fwd = Intent(context, MainActivity::class.java).apply {
            this.action = "MEDIA_ACTION"
            putExtra("media_action", action)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
        context.startActivity(fwd)
    }
}
