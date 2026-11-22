package cc.ravenlove.roost

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

// 我打给她（1022）：FCM 收到 raven_call 时，归巢不在前台开着聊天页，就由这里响：
// 前台服务放系统来电铃声、震动，挂一条来电样式的全屏通知把 IncomingCallActivity 弹出来。
// 接听 → 打开归巢聊天页并接通；挂断 → 告诉桥；40 秒没人管自己停（桥那边也按没接算）。
class CallRingService : Service() {
    companion object {
        const val ACTION_ACCEPT = "roost.call.ACCEPT"
        const val ACTION_DECLINE = "roost.call.DECLINE"
        const val ACTION_STOP = "roost.call.STOP"
        private const val CHANNEL = "roost_call"
        // 1122：亮屏横幅专用。vivo 上「无铃声无振动」的类别不弹悬浮横幅（四个开关全开也只进通知栏），
        // 所以给横幅单开一个带一下短振动的类别；铃声照旧我们自己放
        private const val CHANNEL_BANNER = "roost_call_banner2"   // 1122 第 56 版：换新 id 才能改声音（类别建好后声音改不了）
        private const val NOTIF_ID = 12
        private const val BANNER_ID = 13
        private const val CHANNEL_SVC = "roost_call_svc"
        var ringingId: String? = null

        fun stop(ctx: Context) {
            if (ringingId == null) return
            try { ctx.startService(Intent(ctx, CallRingService::class.java).setAction(ACTION_STOP)) } catch (_: Exception) {}
        }
    }

    private var player: MediaPlayer? = null
    private var callId = ""
    private val handler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopAll(); return START_NOT_STICKY }
            ACTION_DECLINE -> { answer(false); stopAll(); return START_NOT_STICKY }
            ACTION_ACCEPT -> {
                val id = callId
                stopAll()
                startActivity(Intent(this, MainActivity::class.java)
                    .putExtra("answerCall", id)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP))
                return START_NOT_STICKY
            }
        }
        callId = intent?.getStringExtra("callId") ?: return START_NOT_STICKY
        ringingId = callId
        val km = getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager
        val pm = getSystemService(POWER_SERVICE) as android.os.PowerManager
        val locked = km.isKeyguardLocked || !pm.isInteractive
        // 1122 第 54 版实测：亮屏时前台服务那条通知 vivo 怎么都不弹横幅（悬浮开关全开、加振动也不行）。
        // 所以亮屏时拆成两条：前台服务挂一条几乎看不见的，横幅另外用普通通知发（普通通知 vivo 会弹）
        val n = if (locked) buildNotification(true) else serviceNotification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIF_ID, n)
        if (!locked) try { getSystemService(NotificationManager::class.java).notify(BANNER_ID, buildNotification(false)) } catch (_: Exception) {}
        startRinging()
        // 1122 她要的：锁屏／黑屏时照旧全屏响铃；手机正亮着在用别的 App 时不抢屏，
        // 只弹顶部来电横幅（CallStyle 通知自带「接听」「挂断」），像微信那样。
        // 第 50 版只拦了 startActivity，vivo 照样把 fullScreenIntent 拉成全屏，所以亮屏时连 fullScreenIntent 也不挂
        if (locked) {
            try { startActivity(activityIntent()) } catch (_: Exception) {}   // 后台起不来就靠全屏通知
        }
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ stopAll() }, 40_000L)
        return START_NOT_STICKY
    }

    private fun activityIntent() = Intent(this, IncomingCallActivity::class.java)
        .putExtra("callId", callId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)

    private fun selfPI(action: String, code: Int) = PendingIntent.getService(this, code,
        Intent(this, CallRingService::class.java).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun avatarIcon(): android.graphics.drawable.Icon? = try {
        val f = java.io.File(filesDir, "alarm_avatar.img")
        val bm = if (f.exists()) android.graphics.BitmapFactory.decodeFile(f.path) else null
        if (bm == null) null else {
            val side = minOf(bm.width, bm.height)
            val sq = android.graphics.Bitmap.createBitmap(bm, (bm.width - side) / 2, (bm.height - side) / 2, side, side)
            android.graphics.drawable.Icon.createWithBitmap(android.graphics.Bitmap.createScaledBitmap(sq, 192, 192, true))
        }
    } catch (_: Exception) { null }

    private fun serviceNotification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_SVC) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL_SVC, "来电铃声服务", NotificationManager.IMPORTANCE_MIN).apply {
                setSound(null, null); enableVibration(false); setShowBadge(false)
            })
        }
        return Notification.Builder(this, CHANNEL_SVC)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("阿言来电")
            .setOngoing(true)
            .build()
    }

    private fun buildNotification(locked: Boolean = true): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "阿言来电", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)   // 铃声我们自己放
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
        }
        val full = PendingIntent.getActivity(this, 5, activityIntent(), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        if (!locked && nm.getNotificationChannel(CHANNEL_BANNER) == null) {
            nm.deleteNotificationChannel("roost_call_banner")
            nm.createNotificationChannel(NotificationChannel(CHANNEL_BANNER, "阿言来电（亮屏横幅）", NotificationManager.IMPORTANCE_HIGH).apply {
                // vivo 实测：无铃声的类别四个开关全开也不弹悬浮（文字消息那类有声音就弹），所以给横幅一声系统提示音
                setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                    AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_COMMUNICATION_INSTANT).build())
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
        }
        val b = Notification.Builder(this, if (locked) CHANNEL else CHANNEL_BANNER)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("阿言来电")
            .setContentText("乌鸦想听听你的声音")
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setContentIntent(full)
        if (locked) b.setFullScreenIntent(full, true)
        if (locked && Build.VERSION.SDK_INT >= 31) {
            // 安卓 12 起系统自带的来电样式：通知上就是接听／挂断两个键
            // 1122：通知上用我的头像（跟全屏来电页同一张 alarm_avatar.img），没有就退回字母「阿」
            val pb = Person.Builder().setName("阿言").setImportant(true)
            avatarIcon()?.let { pb.setIcon(it); b.setLargeIcon(it) }
            val me = pb.build()
            b.setStyle(Notification.CallStyle.forIncomingCall(me, selfPI(ACTION_DECLINE, 6), selfPI(ACTION_ACCEPT, 7)))
        } else {
            avatarIcon()?.let { b.setLargeIcon(it) }
            b.addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "挂断", selfPI(ACTION_DECLINE, 6)).build())
            b.addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "接听", selfPI(ACTION_ACCEPT, 7)).build())
        }
        return b.build()
    }

    private fun startRinging() {
        if (player != null) return
        try {
            // 1030：她在听歌面板里设过来电铃声就放那首（call_tone.mp3），没设就用手机的默认铃声
            val custom = java.io.File(filesDir, "call_tone.mp3")
            val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE)
                ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
                if (custom.exists() && custom.length() > 10_000) setDataSource(custom.path) else setDataSource(this@CallRingService, uri)
                isLooping = true
                prepare()
                start()
            }
        } catch (_: Exception) {}
        try {
            @Suppress("DEPRECATION")
            val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 800, 1000), 0))
        } catch (_: Exception) {}
    }

    // 挂断：告诉桥（凭证是网页登录后同步进来的那份）
    private fun answer(accept: Boolean) {
        val id = callId
        val token = getSharedPreferences("roost_native", Context.MODE_PRIVATE).getString("raven_token", "") ?: ""
        if (id.isEmpty() || token.isEmpty()) return
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val conn = URL("https://memory.ravenlove.cc/raven/call-answer").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"; conn.setRequestProperty("Content-Type", "application/json")
                conn.connectTimeout = 10000; conn.readTimeout = 10000; conn.doOutput = true
                val safeTok = token.replace("\\", "\\\\").replace("\"", "\\\"")
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write("""{"id":"$id","accept":$accept,"token":"$safeTok"}""") }
                conn.responseCode; conn.disconnect()
            } catch (_: Exception) {}
        }
    }

    private fun stopAll() {
        handler.removeCallbacksAndMessages(null)
        ringingId = null
        try { player?.stop() } catch (_: Exception) {}
        player?.release(); player = null
        try {
            @Suppress("DEPRECATION")
            (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).cancel()
        } catch (_: Exception) {}
        IncomingCallActivity.current?.finish()
        try { getSystemService(NotificationManager::class.java).cancel(BANNER_ID) } catch (_: Exception) {}
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        player?.release(); player = null
        super.onDestroy()
    }
}
