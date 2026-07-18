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
        private const val KEY_REPLY = "key_quick_reply"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // TODO: 把 FCM token 上报到 moon-memory /push/register
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        val title = message.data["title"] ?: message.notification?.title ?: "言叽"
        val body = message.data["body"] ?: message.notification?.body ?: return

        createChannel()
        showNotification(title, body)
    }

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.channel_chat),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "来自涟言的消息"
            enableVibration(true)
        }
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
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
