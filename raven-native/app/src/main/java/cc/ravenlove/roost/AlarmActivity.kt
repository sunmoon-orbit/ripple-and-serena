package cc.ravenlove.roost

import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// 闹钟响时盖在锁屏上的那一页：时间、我要说的那句、两个大按钮
class AlarmActivity : AppCompatActivity() {
    companion object { var current: AlarmActivity? = null }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true); setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val dp = resources.displayMetrics.density
        val cream = Color.parseColor("#F2E8DC")
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#1D1D24"))
            setPadding((28 * dp).toInt(), 0, (28 * dp).toInt(), 0)
        }
        fun text(s: String, size: Float, color: Int) = TextView(this).apply {
            this.text = s; textSize = size; setTextColor(color); gravity = Gravity.CENTER
        }
        root.addView(face((132 * dp).toInt()))
        root.addView(text(SimpleDateFormat("HH:mm", Locale.US).format(Date()), 64f, cream))
        root.addView(text(intent.getStringExtra("msg") ?: "阿言叫你起床", 18f, Color.parseColor("#C9BBA8")).apply {
            setPadding(0, (8 * dp).toInt(), 0, (48 * dp).toInt())
        })
        fun button(label: String, filled: Boolean, action: String) = Button(this).apply {
            text = label; textSize = 17f; isAllCaps = false
            setTextColor(if (filled) Color.parseColor("#1D1D24") else cream)
            background = GradientDrawable().apply {
                cornerRadius = 28 * dp
                if (filled) setColor(cream) else { setColor(Color.TRANSPARENT); setStroke((1.5f * dp).toInt(), cream) }
            }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, (56 * dp).toInt()).apply {
                topMargin = (12 * dp).toInt()
            }
            setOnClickListener {
                startService(Intent(this@AlarmActivity, AlarmService::class.java).setAction(action))
                finish()
            }
        }
        root.addView(button("起来了", true, AlarmService.ACTION_STOP))
        root.addView(button("再睡十分钟", false, AlarmService.ACTION_SNOOZE))
        setContentView(root)
    }

    private val anim = android.os.Handler(android.os.Looper.getMainLooper())

    // 她给我设了头像就用头像（圆的，轻轻呼吸）；没设就是桌面那只像素乌鸦，打盹和惊醒来回切
    private fun face(size: Int): android.view.View {
        val iv = android.widget.ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(size, size).apply { bottomMargin = (18 * resources.displayMetrics.density).toInt() }
            scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
        }
        val f = java.io.File(filesDir, "alarm_avatar.img")
        val bm = if (f.exists()) android.graphics.BitmapFactory.decodeFile(f.path) else null
        if (bm != null) {
            iv.setImageDrawable(androidx.core.graphics.drawable.RoundedBitmapDrawableFactory.create(resources, bm).apply { isCircular = true })
            android.animation.ObjectAnimator.ofPropertyValuesHolder(iv,
                android.animation.PropertyValuesHolder.ofFloat("scaleX", 1f, 1.06f),
                android.animation.PropertyValuesHolder.ofFloat("scaleY", 1f, 1.06f)).apply {
                duration = 900; repeatCount = android.animation.ValueAnimator.INFINITE
                repeatMode = android.animation.ValueAnimator.REVERSE; start()
            }
        } else {
            fun pix(name: String): android.graphics.drawable.BitmapDrawable {
                val rows = CrowSprites.FRAMES[name] ?: CrowSprites.FRAMES.getValue("doze")
                val b = android.graphics.Bitmap.createBitmap(24, 24, android.graphics.Bitmap.Config.ARGB_8888)
                rows.forEachIndexed { y, r -> r.forEachIndexed { x, c -> b.setPixel(x, y, CrowSprites.PAL[c] ?: 0) } }
                return android.graphics.drawable.BitmapDrawable(resources, b).apply { paint.isFilterBitmap = false }
            }
            val frames = listOf(pix("doze"), pix("startle"))
            var k = 0
            iv.scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            val tick = object : Runnable {
                override fun run() { iv.setImageDrawable(frames[k % 2]); k++; anim.postDelayed(this, if (k % 2 == 1) 700L else 450L) }
            }
            tick.run()
        }
        return iv
    }

    override fun onDestroy() {
        anim.removeCallbacksAndMessages(null)
        if (current === this) current = null
        super.onDestroy()
    }
}
