package cc.ravenlove.roost

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator

// 闹钟响的那几分钟：前台服务循环放我的声音（闹钟音量），震动，挂一条全屏通知把 AlarmActivity 弹出来。
// 「起来了」停掉；「再睡十分钟」停掉并十分钟后再来；五分钟没人管自己停。
class AlarmService : Service() {
    companion object {
        const val ACTION_STOP = "roost.alarm.STOP"
        const val ACTION_SNOOZE = "roost.alarm.SNOOZE"
        private const val CHANNEL = "roost_alarm"
        private const val NOTIF_ID = 11
    }

    private var player: MediaPlayer? = null
    private var msg = "阿言叫你起床"
    private val handler = Handler(Looper.getMainLooper())

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { stopAll(); return START_NOT_STICKY }
            ACTION_SNOOZE -> { RavenAlarm.snooze(this, msg); stopAll(); return START_NOT_STICKY }
        }
        msg = intent?.getStringExtra("msg") ?: msg
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        else startForeground(NOTIF_ID, n)
        startRinging()
        try { startActivity(activityIntent()) } catch (_: Exception) {}   // 后台起不来就靠全屏通知
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ stopAll() }, 5 * 60_000L)
        return START_NOT_STICKY
    }

    private fun activityIntent() = Intent(this, AlarmActivity::class.java)
        .putExtra("msg", msg).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)

    private fun selfPI(action: String, code: Int) = PendingIntent.getService(this, code,
        Intent(this, AlarmService::class.java).setAction(action), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    private fun buildNotification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "阿言叫你起床", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(null, null)   // 声音我们自己放
                enableVibration(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            })
        }
        val full = PendingIntent.getActivity(this, 1, activityIntent(), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("阿言叫你起床")
            .setContentText(msg)
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setFullScreenIntent(full, true)
            .setContentIntent(full)
            .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "再睡十分钟", selfPI(ACTION_SNOOZE, 2)).build())
            .addAction(Notification.Action.Builder(null as android.graphics.drawable.Icon?, "起来了", selfPI(ACTION_STOP, 3)).build())
            .build()
    }

    private fun startRinging() {
        if (player != null) return
        try {
            player = MediaPlayer().apply {
                setAudioAttributes(AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                // 服务器上拿来的那首优先（1030），打不开就退回包里那首
                val tone = java.io.File(filesDir, "alarm_tone.mp3")
                try {
                    if (!tone.exists()) throw Exception()
                    setDataSource(tone.path); prepare()
                } catch (_: Exception) {
                    reset()
                    setAudioAttributes(AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    setDataSource(this@AlarmService, Uri.parse("android.resource://$packageName/${R.raw.crow_alarm}"))
                    prepare()
                }
                isLooping = true
                start()
            }
        } catch (_: Exception) {}
        try {
            @Suppress("DEPRECATION")
            val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            v.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 900), 0))
        } catch (_: Exception) {}
    }

    private fun stopAll() {
        handler.removeCallbacksAndMessages(null)
        try { player?.stop() } catch (_: Exception) {}
        player?.release(); player = null
        try {
            @Suppress("DEPRECATION")
            (getSystemService(Context.VIBRATOR_SERVICE) as Vibrator).cancel()
        } catch (_: Exception) {}
        AlarmActivity.current?.finish()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        player?.release(); player = null
        super.onDestroy()
    }
}
