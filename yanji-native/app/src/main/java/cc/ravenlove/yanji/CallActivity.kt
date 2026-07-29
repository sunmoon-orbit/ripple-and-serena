package cc.ravenlove.yanji

import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioManager
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
    private var vibrator: Vibrator? = null
    private val timeout = Handler(Looper.getMainLooper())

    companion object {
        const val EXTRA_REASON = "reason"
        // 和通知的 setTimeoutAfter(90_000)、服务端 invite ttl:90 对齐
        private const val RING_MS = 90_000L
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockscreen()
        setContentView(R.layout.activity_call)

        findViewById<TextView>(R.id.call_reason).text =
            intent.getStringExtra(EXTRA_REASON)?.takeIf { it.isNotBlank() } ?: "想你了"

        findViewById<TextView>(R.id.btn_answer).setOnClickListener { answer() }
        findViewById<TextView>(R.id.btn_decline).setOnClickListener { decline() }

        startRinging()
        // 响够 90 秒自己收摊。留言由前端在下次打开言叽时补（服务端会把这条标 expired）
        timeout.postDelayed({ dismiss() }, RING_MS)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        showOverLockscreen()
        findViewById<TextView>(R.id.call_reason).text =
            intent.getStringExtra(EXTRA_REASON)?.takeIf { it.isNotBlank() } ?: "想你了"
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

    // 铃声走系统默认来电铃，音量通道也用来电通道——她把媒体音量调没了也照样响。
    // ⚠️ 静音/振动档不出声：来电页比通知更打扰，静音档还硬响会挨骂。
    private fun startRinging() {
        val am = getSystemService(AUDIO_SERVICE) as AudioManager
        if (am.ringerMode == AudioManager.RINGER_MODE_NORMAL) {
            try {
                val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_RINGTONE)
                    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
                player = MediaPlayer().apply {
                    setDataSource(this@CallActivity, uri)
                    setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    isLooping = true
                    prepare()
                    start()
                }
            } catch (_: Exception) { /* 拿不到铃声就只震动 */ }
        }

        if (am.ringerMode != AudioManager.RINGER_MODE_SILENT) {
            vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                (getSystemService(VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
            } else {
                @Suppress("DEPRECATION") getSystemService(VIBRATOR_SERVICE) as Vibrator
            }
            val pattern = longArrayOf(0, 800, 900)
            vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))  // 0 = 从头循环
        }
    }

    private fun stopRinging() {
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
        super.onDestroy()
    }

    // 来电页不能用返回键划走——按返回等于挂断，别让它悄悄退到后台还在响
    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        dismiss()
    }
}
