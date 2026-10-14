package cc.ravenlove.roost

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

// 桌面小乌鸦＋桌面歌词（1015 凌晨和阿颖一起画的）：归巢退到后台时，屏幕边上蹲一只像素乌鸦。
// 页面报状态进来：doze 打盹、write 我在回她、listen 在放歌、proudhat 放的是她点给我的歌（戴礼帽）；
// 有歌词就在旁边飘当前这一句。点一下吓一跳、回到归巢；按住能拖。
// 回到归巢里就收起来（里面有自己的播放条，不用重复）。要「显示在其他应用上层」权限，没给就什么都不显示。
class CrowOverlay private constructor(private val ctx: Context) {

    companion object {
        @Volatile private var inst: CrowOverlay? = null
        fun get(c: Context): CrowOverlay = inst ?: synchronized(this) { inst ?: CrowOverlay(c.applicationContext).also { inst = it } }
        private const val PREFS = "roost_crow"
    }

    private val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val ui = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private var img: ImageView? = null
    private var txt: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private var foreground = true
    private var state = "doze"
    private var lyric = ""
    private var startleUntil = 0L
    private val cache = HashMap<String, Bitmap>()
    private var bob = false

    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(v) { prefs.edit().putBoolean("enabled", v).apply(); refresh() }

    fun canDraw(): Boolean = Settings.canDrawOverlays(ctx)

    fun setForeground(fg: Boolean) { foreground = fg; refresh() }
    fun setState(s: String) { if (s != state) { state = s; render() } }
    fun setLyric(l: String) { if (l != lyric) { lyric = l; render() } }

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics)

    private fun frame(name: String): Bitmap = cache.getOrPut(name) {
        val rows = CrowSprites.FRAMES[name] ?: CrowSprites.FRAMES.getValue("doze")
        val bm = Bitmap.createBitmap(24, 24, Bitmap.Config.ARGB_8888)
        rows.forEachIndexed { y, r -> r.forEachIndexed { x, c -> bm.setPixel(x, y, CrowSprites.PAL[c] ?: 0) } }
        bm
    }

    private fun refresh() {
        val want = enabled && !foreground && canDraw()
        if (want && root == null) attach() else if (!want && root != null) detach()
        render()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attach() {
        val iv = ImageView(ctx).apply {
            val s = dp(64f).toInt()
            layoutParams = LinearLayout.LayoutParams(s, s)
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        // 像素图放大时不要糊：关掉 bitmap 过滤
        val tv = TextView(ctx).apply {
            setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setShadowLayer(dp(3f), 0f, dp(1f), 0xCC000000.toInt())
            maxWidth = dp(230f).toInt(); maxLines = 2
            setPadding(dp(10f).toInt(), dp(5f).toInt(), dp(10f).toInt(), dp(5f).toInt())
            background = GradientDrawable().apply { cornerRadius = dp(14f); setColor(0x66000000) }
        }
        val ll = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            addView(iv); addView(tv)
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = prefs.getInt("x", 0); y = prefs.getInt("y", dp(160f).toInt())
        }
        var downX = 0f; var downY = 0f; var ox = 0; var oy = 0; var moved = false
        ll.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; ox = lp.x; oy = lp.y; moved = false }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (abs(dx) > dp(6f) || abs(dy) > dp(6f)) moved = true
                    if (moved) { lp.x = ox + dx.toInt(); lp.y = oy + dy.toInt(); try { wm.updateViewLayout(ll, lp) } catch (_: Exception) {} }
                }
                MotionEvent.ACTION_UP -> {
                    if (moved) prefs.edit().putInt("x", lp.x).putInt("y", lp.y).apply()
                    else tapped()
                }
            }
            true
        }
        try { wm.addView(ll, lp) } catch (_: Exception) { return }
        root = ll; img = iv; txt = tv; params = lp
        ui.post(bobber)
    }

    private fun detach() {
        ui.removeCallbacks(bobber)
        root?.let { try { wm.removeView(it) } catch (_: Exception) {} }
        root = null; img = null; txt = null; params = null
    }

    // 点一下：吓一跳，半秒后回归巢
    private fun tapped() {
        startleUntil = System.currentTimeMillis() + 600
        render()
        ui.postDelayed({
            val i = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            try { ctx.startActivity(i) } catch (_: Exception) {}
        }, 450)
    }

    // 听歌的时候脑袋一点一点；别的时候不动
    private val bobber = object : Runnable {
        override fun run() {
            val iv = img ?: return
            val dancing = state == "listen" || state == "proudhat"
            bob = dancing && !bob
            iv.translationY = if (bob) dp(2f) else 0f
            ui.postDelayed(this, 480)
        }
    }

    private fun render() {
        val iv = img ?: return
        val name = if (System.currentTimeMillis() < startleUntil) "startle" else state
        val d = android.graphics.drawable.BitmapDrawable(ctx.resources, frame(name)).apply { paint.isFilterBitmap = false }
        iv.setImageDrawable(d)
        txt?.let { it.text = lyric; it.visibility = if (lyric.isBlank()) View.GONE else View.VISIBLE }
        if (System.currentTimeMillis() < startleUntil) ui.postDelayed({ render() }, 650)
    }

    fun release() { detach() }
}
