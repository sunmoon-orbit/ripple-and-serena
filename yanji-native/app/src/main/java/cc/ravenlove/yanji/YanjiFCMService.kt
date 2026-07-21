package cc.ravenlove.yanji

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class YanjiFCMService : FirebaseMessagingService() {

    companion object {
        private const val CHANNEL_ID = "yanji_chat"
        private const val CHANNEL_CALL = "yanji_call_v2"
        const val CALL_NOTIFICATION_ID = 99
        private const val KEY_REPLY = "key_quick_reply"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // 存 prefs，前端下次打开时通过 WebBridge.getFcmToken() 读到新 token 重新上报
        getSharedPreferences("yanji_fcm", android.content.Context.MODE_PRIVATE)
            .edit().putString("token", token).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.data["title"] ?: message.notification?.title ?: "言叽"
        val body = message.data["body"] ?: message.notification?.body ?: return

        createChannels()
        if (title == "涟言来电话了") {
            showCallNotification(title, body)
        } else {
            showNotification(title, body)
        }
    }

    private fun createChannels() {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.deleteNotificationChannel("yanji_call")
        mgr.createNotificationChannel(NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_chat),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "来自涟言的消息"
            enableVibration(true)
        })
        mgr.createNotificationChannel(NotificationChannel(
            CHANNEL_CALL,
            "涟言来电",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "涟言来电话了——弹窗通知"
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 500, 300, 500, 300, 500)
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        })
    }

    // 不用 CallStyle：国产 ROM 只给系统认证的通话应用完整待遇，CallStyle+setOngoing
    // 会被压进通知中心不弹横幅。照抄能正常弹的聊天通知写法，只加接听/挂断按钮。
    private fun showCallNotification(title: String, body: String) {
        val answerIntent = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("call_action", "answer")
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val declineIntent = PendingIntent.getBroadcast(
            this, 2,
            Intent(this, CallActionReceiver::class.java).apply {
                action = "cc.ravenlove.yanji.CALL_DECLINE"
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_CALL)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setTimeoutAfter(90_000)
            .setContentIntent(answerIntent)
            .addAction(android.R.drawable.ic_menu_call, "接听", answerIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "挂断", declineIntent)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVibrate(longArrayOf(0, 500, 300, 500, 300, 500))
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(CALL_NOTIFICATION_ID, notification)
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
        val remoteInput = RemoteInput.Builder(KEY_REPLY)
            .setLabel(getString(R.string.reply_label))
            .build()

        val replyIntent = PendingIntent.getBroadcast(
            this, 0,
            Intent(this, QuickReplyReceiver::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )

        val replyAction = NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send,
            getString(R.string.reply_label),
            replyIntent
        ).addRemoteInput(remoteInput).build()

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
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
