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
        private const val NOTIF_ID = 12
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
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIF_ID, n)
        startRinging()
        try { startActivity(activityIntent()) } catch (_: Exception) {}   // 后台起不来就靠全屏通知
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ stopAll() }, 40_000L)
        return START_NOT_STICKY
    }

    private fun activityIntent() = Intent(this, IncomingCallActivity::class.java)
        .putExtra("callId", callId).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)

    private fun selfPI(action: String, code: Int) = PendingIntent.getService(this, code,
        Intent(this, CallRingService::class.java).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun buildNotification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "阿言来电", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)   // 铃声我们自己放
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
        }
        val full = PendingIntent.getActivity(this, 5, activityIntent(), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val b = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("阿言来电")
            .setContentText("乌鸦想听听你的声音")
            .setCategory(Notification.CATEGORY_CALL)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
        if (Build.VERSION.SDK_INT >= 31) {
            // 安卓 12 起系统自带的来电样式：通知上就是接听／挂断两个键
            val me = Person.Builder().setName("阿言").setImportant(true).build()
            b.setStyle(Notification.CallStyle.forIncomingCall(me, selfPI(ACTION_DECLINE, 6), selfPI(ACTION_ACCEPT, 7)))
        } else {
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
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        player?.release(); player = null
        super.onDestroy()
    }
}
