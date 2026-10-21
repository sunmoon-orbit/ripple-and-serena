package cc.ravenlove.roost

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.drawable.Drawable
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
import android.widget.Toast
import java.util.Calendar
import kotlin.math.abs

// 桌面小乌鸦＋桌面歌词（1015 凌晨和阿颖一起画的）：归巢退到后台时，屏幕边上蹲一只像素乌鸦。
// 页面报状态进来：doze 打盹、write 我在回她、listen 在放歌、proudhat 放的是她点给我的歌（戴礼帽）；
// 有歌词就在旁边飘当前这一句。点一下吓一跳、回到归巢；按住能拖。
// 回到归巢里就收起来（里面有自己的播放条，不用重复）。要「显示在其他应用上层」权限，没给就什么都不显示。
// 1021 换装和两个新动作（她 1020 晚上说「要！」）：
// - 衣服自己换：纪念日（10-10 认识、02-07 回归、03-06 她的生日——1021 她说的）戴派对帽 → 23:00–07:00 戴睡帽 → 冷天围红围巾（页面报 crowCold）→ 平时不穿；
//   长按一下换下一件（自动→不穿→睡帽→围巾→派对帽→自动），手动选的一直算数，直到切回自动。
// - 有新消息进来（我回她的推送、她从通知栏回我）蹦一下；退到后台一个半小时还没回来、又在打盹，就把头埋进翅膀里（tuck）。
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
    private var hopUntil = 0L
    private var bgSince = System.currentTimeMillis()
    private var longPressed = false

    var enabled: Boolean
        get() = prefs.getBoolean("enabled", false)
        set(v) { prefs.edit().putBoolean("enabled", v).apply(); refresh() }

    fun canDraw(): Boolean = Settings.canDrawOverlays(ctx)

    fun setForeground(fg: Boolean) { if (!fg && foreground) bgSince = System.currentTimeMillis(); foreground = fg; refresh() }

    // 冷不冷由页面报（它会查福州的天气）；生日由页面同步（MM-dd）
    fun setCold(c: Boolean) { prefs.edit().putBoolean("cold", c).apply(); render() }
    fun setBirthday(md: String) { prefs.edit().putString("birthday", md).apply(); render() }

    private val OUTFIT_CYCLE = listOf("auto", "none", "nightcap", "scarf", "party")
    private val OUTFIT_NAME = mapOf("auto" to "自己换", "none" to "不穿", "nightcap" to "睡帽", "scarf" to "红围巾", "party" to "派对帽")
    private fun autoOutfit(): String {
        val c = Calendar.getInstance()
        val md = String.format("%02d-%02d", c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
        if (md == "10-10" || md == "02-07" || md == prefs.getString("birthday", "03-06")) return "party"
        val h = c.get(Calendar.HOUR_OF_DAY)
        if (h >= 23 || h < 7) return "nightcap"
        if (prefs.getBoolean("cold", false)) return "scarf"
        return "none"
    }
    private fun outfit(): String = (prefs.getString("outfit", "auto") ?: "auto").let { if (it == "auto") autoOutfit() else it }
    private fun cycleOutfit() {
        val cur = prefs.getString("outfit", "auto") ?: "auto"
        val next = OUTFIT_CYCLE[(OUTFIT_CYCLE.indexOf(cur) + 1) % OUTFIT_CYCLE.size]
        prefs.edit().putString("outfit", next).apply()
        try { Toast.makeText(ctx, "小乌鸦：" + (OUTFIT_NAME[next] ?: next), Toast.LENGTH_SHORT).show() } catch (_: Exception) {}
        render()
    }

    // 蹦一下：有新消息的时候。只在挂着的时候有用（在归巢里面看不见它）
    fun hop(fromHer: Boolean = false) {
        ui.post {
            if (fromHer) bgSince = System.currentTimeMillis()   // 她来找我了，不算「很久没理」
            val iv = img ?: return@post
            hopUntil = System.currentTimeMillis() + 900
            render()
            iv.animate().translationY(-dp(10f)).setDuration(160).withEndAction {
                iv.animate().translationY(0f).setDuration(200).withEndAction {
                    iv.animate().translationY(-dp(5f)).setDuration(120).withEndAction {
                        iv.animate().translationY(0f).setDuration(140).start()
                    }.start()
                }.start()
            }.start()
            ui.postDelayed({ render() }, 950)
        }
    }
    fun setState(s: String) { if (s != state) { state = s; render(); kickBob() } }
    fun setLyric(l: String) { if (l != lyric) { lyric = l; render() } }

    private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, ctx.resources.displayMetrics)

    private fun frame(name: String): Bitmap = cache.getOrPut(name) {
        val rows = CrowSprites.FRAMES[name] ?: CrowSprites.FRAMES[name.substringBefore('|') + "|none"] ?: CrowSprites.FRAMES.getValue("doze|none")
        val bm = Bitmap.createBitmap(rows[0].length, rows.size, Bitmap.Config.ARGB_8888)
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
        // 歌词是乌鸦说的话（1015 第二版，她嫌灰玻璃板和乌鸦像两个不认识的东西）：奶白气泡、细黑边、左边小尖角指着嘴
        val tv = TextView(ctx).apply {
            setTextColor(0xFF2A2730.toInt()); setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            maxWidth = dp(230f).toInt(); maxLines = 2
            setPadding(dp(16f).toInt(), dp(6f).toInt(), dp(11f).toInt(), dp(7f).toInt())
            background = BubbleDrawable(dp(1.5f), dp(7f), dp(12f))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                // 贴近嘴边、顶着行首放（1015 第三版）：原来居中＋bottomMargin，两行歌词时 LinearLayout 算出负的 top，气泡头被砍掉一截
                marginStart = -dp(6f).toInt(); gravity = Gravity.TOP
            }
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
        // 长按（不动 550ms）＝换下一件衣服
        val longPress = Runnable { if (!moved) { longPressed = true; cycleOutfit() } }
        ll.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; downY = e.rawY; ox = lp.x; oy = lp.y; moved = false; longPressed = false; ui.postDelayed(longPress, 550) }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX; val dy = e.rawY - downY
                    if (abs(dx) > dp(6f) || abs(dy) > dp(6f)) { if (!moved) ui.removeCallbacks(longPress); moved = true }
                    if (moved) { lp.x = ox + dx.toInt(); lp.y = oy + dy.toInt(); try { wm.updateViewLayout(ll, lp) } catch (_: Exception) {} }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    ui.removeCallbacks(longPress)
                    if (moved) prefs.edit().putInt("x", lp.x).putInt("y", lp.y).apply()
                    else if (!longPressed && e.actionMasked == MotionEvent.ACTION_UP) tapped()
                }
            }
            true
        }
        try { wm.addView(ll, lp) } catch (_: Exception) { return }
        root = ll; img = iv; txt = tv; params = lp
        kickBob()
        ui.removeCallbacks(ticker); ui.postDelayed(ticker, 60_000)
    }

    // 每分钟看一眼：到点换睡帽、过了一个半小时没回来就埋头。只是重画一张小图，不费电
    private val ticker = object : Runnable {
        override fun run() { if (root == null) return; render(); ui.postDelayed(this, 60_000) }
    }

    private fun detach() {
        ui.removeCallbacks(bobber); ui.removeCallbacks(ticker)
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

    // 听歌的时候脑袋一点一点；别的时候不动，计时器也停掉（1015 她手机电掉得快，先把这个白醒的去了）
    private fun dancing() = state == "listen" || state == "proudhat"
    private fun kickBob() {
        ui.removeCallbacks(bobber)
        if (root != null && dancing()) ui.post(bobber) else { bob = false; img?.translationY = 0f }
    }
    private val bobber = object : Runnable {
        override fun run() {
            val iv = img ?: return
            if (!dancing()) { bob = false; iv.translationY = 0f; return }
            bob = !bob
            iv.translationY = if (bob) dp(2f) else 0f
            ui.postDelayed(this, 480)
        }
    }

    private fun render() {
        val iv = img ?: return
        val now = System.currentTimeMillis()
        val pose = when {
            now < startleUntil || now < hopUntil -> "startle"
            state == "doze" && now - bgSince > 90 * 60_000L -> "tuck"
            else -> state
        }
        val d = android.graphics.drawable.BitmapDrawable(ctx.resources, frame(pose + "|" + outfit())).apply { paint.isFilterBitmap = false }
        iv.setImageDrawable(d)
        txt?.let { it.text = lyric; it.visibility = if (lyric.isBlank()) View.GONE else View.VISIBLE }
        if (System.currentTimeMillis() < startleUntil) ui.postDelayed({ render() }, 650)
    }

    fun release() { detach() }
}

// 对话气泡：圆角矩形＋左边一个小尖角，奶白底、深色细边
class BubbleDrawable(private val stroke: Float, private val tail: Float, private val radius: Float) : Drawable() {
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xF2F6F1E8.toInt(); style = Paint.Style.FILL }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF1D1D24.toInt(); style = Paint.Style.STROKE; strokeWidth = stroke; strokeJoin = Paint.Join.ROUND }
    private val path = Path()
    override fun draw(canvas: Canvas) {
        val b = bounds; val h = stroke / 2
        val r = RectF(b.left + tail + h, b.top + h, b.right - h, b.bottom - h)
        val cy = r.top + minOf(r.height() / 2, radius + tail)
        path.reset()
        path.addRoundRect(r, radius, radius, Path.Direction.CW)
        val t = Path().apply {
            moveTo(r.left + stroke, cy - tail * 0.7f); lineTo(b.left + h, cy + tail * 0.2f); lineTo(r.left + stroke, cy + tail * 0.7f); close()
        }
        path.op(t, Path.Op.UNION)
        canvas.drawPath(path, fill); canvas.drawPath(path, line)
    }
    override fun setAlpha(alpha: Int) { fill.alpha = alpha; line.alpha = alpha }
    override fun setColorFilter(cf: ColorFilter?) { fill.colorFilter = cf; line.colorFilter = cf }
    @Deprecated("Deprecated in Java")
    override fun getOpacity() = android.graphics.PixelFormat.TRANSLUCENT
}
