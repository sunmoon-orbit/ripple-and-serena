package cc.ravenlove.roost

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class RoostFCMService : FirebaseMessagingService() {

    companion object {
        private const val CHANNEL_ID = "roost_chat"
        const val KEY_REPLY = "key_quick_reply"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // 存 prefs，前端下次打开时通过 WebBridge.getFcmToken() 读到新 token 重新上报。
        // token 会在重装/清数据/Google 主动轮换时变，所以「上报一次就完了」是错的。
        getSharedPreferences("roost_fcm", Context.MODE_PRIVATE)
            .edit().putString("token", token).remove("error").apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.data["title"] ?: message.notification?.title ?: "归巢"
        val body = message.data["body"] ?: message.notification?.body ?: return

        createChannel()
        showNotification(title, body)
    }

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL_ID, getString(R.string.channel_chat), NotificationManager.IMPORTANCE_HIGH).apply {
                description = "来自阿言的消息"
                enableVibration(true)
            }
        )
    }

    private fun showNotification(title: String, body: String) {
        val tapIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 通知栏直接回复
        val remoteInput = RemoteInput.Builder(KEY_REPLY).setLabel(getString(R.string.reply_label)).build()
        val replyIntent = PendingIntent.getBroadcast(
            this, 0,
            Intent(this, QuickReplyReceiver::class.java),
            // ⚠️ 必须是 MUTABLE：RemoteInput 要往 Intent 里塞用户输入的文字，
            // IMMUTABLE 的话回复内容根本传不进来
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        val replyAction = NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send, getString(R.string.reply_label), replyIntent
        ).addRemoteInput(remoteInput).build()

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            // ⚠️ 首版误用了 android.R.drawable.ic_dialog_email（安卓自带的信封），
            // 通知栏上根本不像归巢。小图标只认 alpha 通道，必须是单色剪影，
            // 塞彩色 PNG 会变成一坨白块——所以是矢量 drawable，不是 mipmap 那张图。
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFFC4A882.toInt())   // 系统给剪影上的色，归巢的暖金
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(tapIntent)
            .addAction(replyAction)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(System.currentTimeMillis().toInt(), notification)
    }
}
