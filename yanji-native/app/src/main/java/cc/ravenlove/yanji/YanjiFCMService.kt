package cc.ravenlove.yanji

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.RemoteInput
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class YanjiFCMService : FirebaseMessagingService() {

    companion object {
        private const val CHANNEL_ID = "yanji_chat"
        // ⚠️ 渠道一旦建出来，设置就被系统冻结了，代码里再改也不生效——
        // 所以每次改渠道属性都必须换新 id，并把旧的删掉。v3（0804）= 加 bypassDnd。
        private const val CHANNEL_CALL = "yanji_call_v4"
        private const val CHANNEL_CALL_BASIC = "yanji_call_v4_basic"
        const val CALL_NOTIFICATION_ID = 99
        const val KEY_REPLY = "key_quick_reply"   // MainActivity 从 intent 里取回复文字时要用
        const val DIAGNOSTICS_PREFS = "yanji_diagnostics"
        const val CALL_CHANNEL_PROBLEM = "call_channel_problem"
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

        val callChannel = createChannels()
        val isCall = message.data["type"] == "call" ||
            (message.data["type"] == null && title == "涟言来电话了")
        if (isCall) {
            showCallNotification(title, body, message.data["inviteId"], callChannel)
        } else {
            showNotification(title, body)
        }
    }

    private fun createChannels(): String {
        val mgr = getSystemService(NotificationManager::class.java)
        cleanLegacyCallChannelsOnce(mgr)
        try {
            mgr.createNotificationChannel(NotificationChannel(
                CHANNEL_ID, getString(R.string.channel_chat), NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "来自涟言的消息"
                enableVibration(true)
            })
        } catch (e: Exception) {
            android.util.Log.e("YanjiFCM", "聊天通知渠道创建失败", e)
        }
        try {
            val granted = mgr.isNotificationPolicyAccessGranted
            val channelId = if (granted) CHANNEL_CALL else CHANNEL_CALL_BASIC
            mgr.createNotificationChannel(callChannel(channelId, granted))
            recordCallChannelProblem(mgr, channelId, granted)
            return channelId
        } catch (e: Exception) {
            android.util.Log.e("YanjiFCM", "穿透勿扰的来电渠道创建失败，降级为普通渠道", e)
            return try {
                mgr.createNotificationChannel(callChannel(CHANNEL_CALL_BASIC, false))
                recordCallChannelProblem(mgr, CHANNEL_CALL_BASIC, false)
                CHANNEL_CALL_BASIC
            } catch (fallbackError: Exception) {
                // 聊天渠道已先创建；极端厂商 ROM 连普通来电渠道也拒绝时，至少仍画得出通知。
                android.util.Log.e("YanjiFCM", "普通来电渠道也创建失败，借用聊天渠道", fallbackError)
                getSharedPreferences(DIAGNOSTICS_PREFS, android.content.Context.MODE_PRIVATE)
                    .edit().putString(CALL_CHANNEL_PROBLEM, "系统没能创建来电通知渠道").apply()
                CHANNEL_ID
            }
        }
    }

    // 删旧渠道只做一次（0804）。原来这三行直接写在 createChannels() 里，
    // 而 createChannels() 每收到**一条消息**就跑一遍——等于把 delete/recreate 当「重置渠道」用。
    // 它并不重置：同 id 重建会恢复删除前的设置，系统设置里「已删除的通知类别」计数还会一直涨。
    private fun cleanLegacyCallChannelsOnce(mgr: NotificationManager) {
        val prefs = getSharedPreferences("yanji_channels", android.content.Context.MODE_PRIVATE)
        if (prefs.getBoolean("legacy_call_cleaned", false)) return
        try {
            mgr.deleteNotificationChannel("yanji_call")
            mgr.deleteNotificationChannel("yanji_call_v2")
            mgr.deleteNotificationChannel("yanji_call_v3")
            prefs.edit().putBoolean("legacy_call_cleaned", true).apply()
        } catch (e: Exception) {
            android.util.Log.e("YanjiFCM", "旧来电通知渠道清理失败", e)
        }
    }

    // 建完读回系统里的真实状态（0804）。createNotificationChannel() 返回 void，
    // 传进去 IMPORTANCE_HIGH **不代表**系统采纳了：同 id 的旧设置会被恢复，她也可能自己关掉。
    // 从前这里直接 return channelId，等于默认自己请求的就生效了——
    // 于是「通知在、屏不亮」这一类问题永远查不出来。后台服务里不能弹 UI，先存起来，
    // MainActivity 下次打开时读出来告诉她。
    private fun recordCallChannelProblem(
        mgr: NotificationManager,
        channelId: String,
        policyAccessGranted: Boolean
    ) {
        val actual = mgr.getNotificationChannel(channelId)
        val problem = when {
            actual == null -> "系统里没有找到来电通知渠道"
            actual.importance == NotificationManager.IMPORTANCE_NONE -> "来电通知渠道被关掉了"
            actual.importance < NotificationManager.IMPORTANCE_HIGH -> "来电通知渠道不是高优先级，可能不会亮屏提醒"
            policyAccessGranted && !actual.canBypassDnd() -> "来电通知渠道还不能穿过勿扰模式"
            else -> null
        }
        getSharedPreferences(DIAGNOSTICS_PREFS, android.content.Context.MODE_PRIVATE)
            .edit().putString(CALL_CHANNEL_PROBLEM, problem).apply()
    }

    private fun callChannel(channelId: String, bypassDnd: Boolean) = NotificationChannel(
        channelId, "涟言来电", NotificationManager.IMPORTANCE_HIGH
    ).apply {
        description = "涟言来电话了——弹窗通知"
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 500, 300, 500, 300, 500)
        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
        if (bypassDnd) setBypassDnd(true)
    }

    // 不用 CallStyle：国产 ROM 只给系统认证的通话应用完整待遇，CallStyle+setOngoing
    // 会被压进通知中心不弹横幅。照抄能正常弹的聊天通知写法，只加接听/挂断按钮。
    private fun showCallNotification(title: String, body: String, callId: String?, channelId: String) {
        val answerIntent = PendingIntent.getBroadcast(
            this, callRequestCode(IntentIdentity.REQUEST_CALL_ANSWER, callId),
            Intent(this, CallActionReceiver::class.java).apply {
                action = IntentIdentity.ACTION_CALL_ANSWER
                data = callIntentData("answer", callId)
                putExtra(CallActivity.EXTRA_CALL_ID, callId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val declineIntent = PendingIntent.getBroadcast(
            this, callRequestCode(IntentIdentity.REQUEST_CALL_DECLINE, callId),
            Intent(this, CallActionReceiver::class.java).apply {
                action = IntentIdentity.ACTION_CALL_DECLINE
                data = callIntentData("decline", callId)
                putExtra(CallActivity.EXTRA_CALL_ID, callId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // 全屏来电（0729 加）：锁屏时把整个界面拉起来，微信语音来电那种效果。
        // ⚠️ 不能复用 answerIntent——它带 call_action=answer，屏幕一亮就等于自动接听了。
        // 0729 二版：原来指 MainActivity，亮屏后进的是**上次停在哪儿的网页**，要等 WebView
        // 加载完 + 轮询到 invite 才弹响铃卡片。改指 CallActivity——原生页，屏幕亮起的
        // 那一瞬间画面就已经是通话界面了。
        val fullScreenIntent = PendingIntent.getActivity(
            this, callRequestCode(IntentIdentity.REQUEST_CALL_FULLSCREEN, callId),
            Intent(this, CallActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                action = IntentIdentity.ACTION_CALL_FULLSCREEN
                data = callIntentData("fullscreen", callId)
                putExtra(CallActivity.EXTRA_REASON, body)
                putExtra(CallActivity.EXTRA_CALL_ID, callId)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = NotificationCompat.Builder(this, channelId)
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

    private fun callRequestCode(base: Int, callId: String?): Int =
        base + ((callId?.hashCode() ?: 0) and 0x3ff)

    private fun callIntentData(purpose: String, callId: String?): Uri = Uri.Builder()
        .scheme("yanji")
        .authority("call")
        .appendPath(purpose)
        .appendPath(callId ?: "without-id")
        .build()

    private fun showNotification(title: String, body: String) {
        val notifId = System.currentTimeMillis().toInt()

        val tapIntent = PendingIntent.getActivity(
            this, IntentIdentity.REQUEST_CHAT_OPEN,
            Intent(this, MainActivity::class.java).apply {
                action = IntentIdentity.ACTION_CHAT_OPEN
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
