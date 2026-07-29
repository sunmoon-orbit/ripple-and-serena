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
        const val KEY_REPLY = "key_quick_reply"   // MainActivity 从 intent 里取回复文字时要用
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

        // 全屏来电（0729 加）：锁屏时把整个界面拉起来，微信语音来电那种效果。
        // ⚠️ 这里**不能复用 answerIntent**——它带 call_action=answer，屏幕一亮就等于自动接听了。
        // 单开一个 incoming：只负责把 app 拉到前台，响铃卡片由前端自己弹（它本来就在轮询 invite）。
        val fullScreenIntent = PendingIntent.getActivity(
            this, 3,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("call_action", "incoming")
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
            // 第二个参数 true = 高优先级，允许打断当前界面/点亮锁屏。
            // 系统在「屏幕锁着或息屏」时走全屏，「正在用手机」时自动降级成横幅——不会抢她正在做的事。
            .setFullScreenIntent(fullScreenIntent, true)
            .addAction(android.R.drawable.ic_menu_call, "接听", answerIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "挂断", declineIntent)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setVibrate(longArrayOf(0, 500, 300, 500, 300, 500))
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(CALL_NOTIFICATION_ID, notification)
    }

    private fun showNotification(title: String, body: String) {
        val notifId = System.currentTimeMillis().toInt()

        val tapIntent = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 通知栏直接回复。
        // ⚠️ 0726 改：原来指向 QuickReplyReceiver，在后台起个 HTTP 请求发给**归巢**的通道——
        // 方向就是错的：在言叽的通知里说的话会跑进归巢，进不了言叽的对话。
        // 言叽的对话在 WebView 的 localStorage 里、API key 也在前端，服务端根本没有一份
        // 可写的言叽会话，所以「留在通知栏里把话发出去」这条路不存在。
        // 改成打开 app 把这句话带进去（PendingIntent 指 Activity 一样收得到 RemoteInput），
        // 落进正确的对话、带完整上下文、走她自己配的模型。代价是要开一次 app，认了。
        val remoteInput = RemoteInput.Builder(KEY_REPLY)
            .setLabel(getString(R.string.reply_label))
            .build()

        val replyIntent = PendingIntent.getActivity(
            this, notifId,   // requestCode 用通知 id：多条通知各带各的 extra，别被 UPDATE_CURRENT 串成一份
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("quick_reply", true)
                putExtra("notif_id", notifId)
            },
            // ⚠️ 必须 MUTABLE：RemoteInput 要往 Intent 里塞她输入的文字，IMMUTABLE 就传不进来
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )

        val replyAction = NotificationCompat.Action.Builder(
            android.R.drawable.ic_menu_send,
            getString(R.string.reply_label),
            replyIntent
        ).addRemoteInput(remoteInput).build()

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            // ⚠️ 0726 前是 android.R.drawable.ic_dialog_email（安卓自带的信封）。
            // 以前 FCM 发的是 notification 型消息、通知由系统托盘画，这行从来没生效过；
            // 改成 data 型之后是 app 自己画，信封才会真露出来。小图标只认 alpha 通道，
            // 必须单色矢量剪影，不能拿 mipmap 那张彩色图。
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF7B6FA2.toInt())   // 系统给剪影上的色，言叽默认主题的紫
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(tapIntent)
            .addAction(replyAction)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        getSystemService(NotificationManager::class.java)
            .notify(notifId, notification)
    }
}
