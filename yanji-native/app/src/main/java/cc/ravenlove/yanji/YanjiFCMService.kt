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
        // ⚠️ 渠道一旦建出来，设置就被系统冻结了，代码里再改也不生效——
        // 所以每次改渠道属性都必须换新 id，并把旧的删掉。v3（0804）= 加 bypassDnd。
        private const val CHANNEL_CALL = "yanji_call_v3"
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
        mgr.deleteNotificationChannel("yanji_call_v2")
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
            // 0804：穿透勿扰。阿颖的勿扰会莫名其妙自动开启（跟她设的 22:00-5:30 定时无关），
            // 一开就把整条来电通知压掉——**连全屏 intent 一起压掉**，那才是漏电话的大头，
            // 比"没声音"严重。这里只放行来电这一个渠道，聊天消息渠道照旧守规矩。
            // ⚠️ 这行要生效，app 必须拿到「通知策略访问权限」；没授权的话系统直接忽略它，
            // 不报错、不提示——所以下面 policyOk() 会在日志里留一行，出问题时先看那儿。
            setBypassDnd(true)
        })
        if (!mgr.isNotificationPolicyAccessGranted) {
            android.util.Log.w("YanjiFCM", "未拿到通知策略访问权限，setBypassDnd 不会生效")
        }
        // 声音不在这儿设：全屏拉起的 CallActivity 自己用**闹钟流**循环放铃声
        // （闹钟流是唯一能穿透硬件静音档的），渠道再配一份会变成两个声音叠着响。
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
        // ⚠️ 不能复用 answerIntent——它带 call_action=answer，屏幕一亮就等于自动接听了。
        // 0729 二版：原来指 MainActivity，亮屏后进的是**上次停在哪儿的网页**，要等 WebView
        // 加载完 + 轮询到 invite 才弹响铃卡片。改指 CallActivity——原生页，屏幕亮起的
        // 那一瞬间画面就已经是通话界面了。
        val fullScreenIntent = PendingIntent.getActivity(
            this, 3,
            Intent(this, CallActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra(CallActivity.EXTRA_REASON, body)
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
