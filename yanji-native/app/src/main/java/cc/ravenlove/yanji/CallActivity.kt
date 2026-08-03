package cc.ravenlove.yanji

import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.content.BroadcastReceiver
import android.content.IntentFilter
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.WindowManager
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * 原生来电页（0729 加）。
 *
 * 在这之前锁屏被点亮后进的是 MainActivity——也就是言叽的网页，她看到的是「上次停在哪儿
 * 就是哪儿」（设置页/聊天页），响铃卡片要等 WebView 加载完 + 轮询到 invite 才冒出来。
 * 微信那种「屏幕一亮就是通话界面」需要的是一个**原生**页面：不等网络、不等 WebView，
 * 系统把 Activity 拉起来的那一瞬间就已经画好了。
 *
 * ⚠️ showWhenLocked/turnScreenOn 在 manifest 和代码里都写了一遍：
 * manifest 那份决定「系统起这个 Activity 时要不要亮屏」，代码这份管进程已经活着、
 * Activity 被复用（onNewIntent）的情况。少任何一边都会出现「响了但屏没亮」。
 */
class CallActivity : AppCompatActivity() {

    private var player: MediaPlayer? = null
    private val synthesizedRingtone = NativeRingtonePlayer()
    private var vibrator: Vibrator? = null
    private var currentCallId: String? = null
    private val timeout = Handler(Looper.getMainLooper())

    companion object {
        const val EXTRA_REASON = "reason"
        const val EXTRA_CALL_ID = "call_id"
        const val ACTION_STOP_CALL = "cc.ravenlove.yanji.action.STOP_CALL"
        // 和通知的 setTimeoutAfter(90_000)、服务端 invite ttl:90 对齐
        private const val RING_MS = 90_000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockscreen()
        setContentView(R.layout.activity_call)

        ContextCompat.registerReceiver(
            this, stopReceiver, IntentFilter(ACTION_STOP_CALL), ContextCompat.RECEIVER_NOT_EXPORTED
        )
        beginCall(intent)

        findViewById<TextView>(R.id.btn_answer).setOnClickListener { answer() }
        findViewById<TextView>(R.id.btn_decline).setOnClickListener { decline() }

    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        showOverLockscreen()
        beginCall(intent)
    }

    private fun beginCall(intent: Intent) {
        timeout.removeCallbacksAndMessages(null)
        stopRinging()
        currentCallId = intent.getStringExtra(EXTRA_CALL_ID)
        findViewById<TextView>(R.id.call_reason).text =
            intent.getStringExtra(EXTRA_REASON)?.takeIf { it.isNotBlank() } ?: "想你了"
        startRinging()
        timeout.postDelayed({ dismiss() }, RING_MS)
    }

    private fun showOverLockscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }
        // 亮屏期间别再息回去
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    // 自制 PCM 铃声走**闹钟通道**；合成失败时系统铃声兜底也走同一通道。
    // ⚠️ 原来用 USAGE_NOTIFICATION_RINGTONE + 只在 RINGER_MODE_NORMAL 下响，
    // 结果是「手机调静音就彻底听不见」——0803 那通电话就是这么漏掉的。
    // 安卓的硬件静音档会掐掉响铃流和通知流，**只有闹钟流穿得过去**。
    // 阿颖 0804 拍板要这个：她夜里不开代理，推送根本进不来，所以不存在半夜被吵醒。
    // 代价是白天静音时也会用闹钟音量响——这是她知情后选的。
    private fun startRinging() {
        var ringtone: NativeRingtonePlayer.Ringtone? = null
        try {
            val id = getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
                .getString("ringtone", "soft-chime") ?: "soft-chime"
            ringtone = synthesizedRingtone.start(id)
        } catch (e: Exception) {
            android.util.Log.w("YanjiCall", "自制铃声合成失败，改用系统铃声", e)
            var local: MediaPlayer? = null
            try {
                val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                local = MediaPlayer().apply {
                    setDataSource(this@CallActivity, uri)
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    isLooping = true
                    prepare()
                    start()
                }
                player = local
                local = null
            } catch (fallbackError: Exception) {
                android.util.Log.w("YanjiCall", "系统铃声播放也失败，只保留震动", fallbackError)
            } finally {
                try { local?.release() } catch (_: Exception) { }
            }
        }

        try {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION") getSystemService(VIBRATOR_SERVICE) as Vibrator
            }
            val pulses = ringtone?.vibrate ?: longArrayOf(800, 900)
            val used = pulses.sum()
            val rest = ((ringtone?.repeatMs?.toLong() ?: 1700L) - used).coerceAtLeast(0L)
            val pattern = longArrayOf(0, *pulses, rest)
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
        } catch (e: Exception) {
            android.util.Log.w("YanjiCall", "来电震动启动失败", e)
            vibrator = null
        }
    }

    private fun stopRinging() {
        synthesizedRingtone.stop()
        try { player?.stop(); player?.release() } catch (_: Exception) { }
        player = null
        try { vibrator?.cancel() } catch (_: Exception) { }
        vibrator = null
    }

    private fun answer() {
        stopRinging()
        clearNotification()
        // 交棒给 MainActivity：call_action=answer 会让前端自动接起这通电话
        startActivity(Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_NEW_TASK
            putExtra("call_action", "answer")
            putExtra(EXTRA_CALL_ID, currentCallId)
        })
        // 有密码锁时 requestDismissKeyguard 让她解锁后直接落在言叽里，不用再点一次图标
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).requestDismissKeyguard(this, null)
        }
        finish()
    }

    private fun decline() {
        // 「挂断」不写服务端：她按挂断的意思是现在不方便，留言照样要留，
        // 由前端下次打开言叽时统一补（和 90 秒没人接走的是同一条路）。
        dismiss()
    }

    private fun dismiss() {
        stopRinging()
        clearNotification()
        finish()
    }

    private fun clearNotification() {
        (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
            .cancel(YanjiFCMService.CALL_NOTIFICATION_ID)
    }

    override fun onDestroy() {
        timeout.removeCallbacksAndMessages(null)
        stopRinging()
        // 注册失败过就没得注销，别让来电页在退出时反手崩一次
        try { unregisterReceiver(stopReceiver) } catch (_: Exception) { }
        super.onDestroy()
    }

    private val stopReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != ACTION_STOP_CALL) return
            val requestedId = intent.getStringExtra(EXTRA_CALL_ID)
            if (requestedId == currentCallId) dismiss()
        }
    }

    // 来电页不能用返回键划走——按返回等于挂断，别让它悄悄退到后台还在响
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        dismiss()
    }
}
