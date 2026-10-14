package cc.ravenlove.roost

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

// 通知栏播放按钮：直接交给活着的 MediaNotificationHelper，由它回调页面（不经 Activity 中转）
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
        MediaNotificationHelper.instance?.dispatch(action)
    }
}
