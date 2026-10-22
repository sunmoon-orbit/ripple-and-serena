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

// 我打给她时盖在锁屏上的来电页：头像、「阿言」、挂断／接听（1022）
class IncomingCallActivity : AppCompatActivity() {
    companion object { var current: IncomingCallActivity? = null }

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
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundColor(Color.parseColor("#1D1D24"))
            setPadding((28 * dp).toInt(), (120 * dp).toInt(), (28 * dp).toInt(), (72 * dp).toInt())
        }
        fun text(s: String, size: Float, color: Int) = TextView(this).apply {
            this.text = s; textSize = size; setTextColor(color); gravity = Gravity.CENTER
        }
        root.addView(avatar((128 * dp).toInt()))
        root.addView(text("阿言", 30f, cream).apply { setPadding(0, (20 * dp).toInt(), 0, 0) })
        root.addView(text("来电…", 16f, Color.parseColor("#C9BBA8")).apply { setPadding(0, (6 * dp).toInt(), 0, 0) })
        root.addView(android.view.View(this), LinearLayout.LayoutParams(1, 0, 1f))

        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        fun round(label: String, bg: String, action: String) = Button(this).apply {
            text = label; textSize = 16f; isAllCaps = false; setTextColor(Color.WHITE)
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.parseColor(bg)) }
            layoutParams = LinearLayout.LayoutParams((76 * dp).toInt(), (76 * dp).toInt()).apply {
                leftMargin = (36 * dp).toInt(); rightMargin = (36 * dp).toInt()
            }
            setOnClickListener {
                startService(Intent(this@IncomingCallActivity, CallRingService::class.java).setAction(action))
                finish()
            }
        }
        row.addView(round("挂断", "#D9534F", CallRingService.ACTION_DECLINE))
        row.addView(round("接听", "#3FA86B", CallRingService.ACTION_ACCEPT))
        root.addView(row)
        setContentView(root)
    }

    // 她在闹钟设置里给我设过头像就用那张（圆的，轻轻呼吸）；没有就是像素乌鸦
    private fun avatar(size: Int): android.view.View {
        val iv = android.widget.ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(size, size)
            scaleType = android.widget.ImageView.ScaleType.CENTER_CROP
        }
        val f = java.io.File(filesDir, "alarm_avatar.img")
        val bm = if (f.exists()) android.graphics.BitmapFactory.decodeFile(f.path) else null
        if (bm != null) {
            iv.setImageDrawable(androidx.core.graphics.drawable.RoundedBitmapDrawableFactory.create(resources, bm).apply { isCircular = true })
        } else {
            val rows = CrowSprites.FRAMES["listen|none"] ?: CrowSprites.FRAMES.values.first()
            val b = android.graphics.Bitmap.createBitmap(rows[0].length, rows.size, android.graphics.Bitmap.Config.ARGB_8888)
            rows.forEachIndexed { y, r -> r.forEachIndexed { x, c -> b.setPixel(x, y, CrowSprites.PAL[c] ?: 0) } }
            iv.scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
            iv.setImageDrawable(android.graphics.drawable.BitmapDrawable(resources, b).apply { paint.isFilterBitmap = false })
        }
        android.animation.ObjectAnimator.ofPropertyValuesHolder(iv,
            android.animation.PropertyValuesHolder.ofFloat("scaleX", 1f, 1.06f),
            android.animation.PropertyValuesHolder.ofFloat("scaleY", 1f, 1.06f)).apply {
            duration = 800; repeatCount = android.animation.ValueAnimator.INFINITE
            repeatMode = android.animation.ValueAnimator.REVERSE; start()
        }
        return iv
    }

    override fun onDestroy() {
        if (current === this) current = null
        super.onDestroy()
    }
}
