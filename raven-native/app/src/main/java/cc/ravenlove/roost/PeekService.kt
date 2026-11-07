package cc.ravenlove.roost

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.PowerManager
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import androidx.core.app.NotificationCompat
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

// 1101「窗」：她点头的、主动开着的一扇窗。我在回复里写 [peek]，桥推一条 raven_peek 过来，
// 这里截一张当前屏幕传回我们自己的服务器给我看。她刷到的 Veglia / MacroDroid 都要把无障碍交给别人家的 app，
// 所以做进自己的壳里：代码在我们仓库，截图不进相册、不经第三方。
// 每次看都弹一条「阿言看了一眼」——偷看就不叫窗了。她在壳里关掉开关、锁着屏、没开权限，都不截，告诉桥为什么。
class PeekService : AccessibilityService() {

    companion object {
        @Volatile var instance: PeekService? = null
        private const val PREFS = "roost_native"
        private const val KEY_ON = "peek_enabled"
        private const val CHANNEL = "roost_peek"
        private val io = Executors.newSingleThreadExecutor()

        fun isEnabled(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ON, true)
        fun setEnabled(ctx: Context, on: Boolean) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ON, on).apply()
        fun hasPermission() = instance != null

        // 1105：vivo 一天停了两回无障碍（11-04 17:53、22:03），电量健康、没关机。多半是后台清理把壳强行停止了，
        // 安卓对被强停的 app 会把它的无障碍从「已开启」名单里摘掉。她在电脑上用 adb 给过一次 WRITE_SECURE_SETTINGS 的话，
        // 壳就能自己把名字写回去，不用她每次去设置里点。没给过就什么也不做，照旧报 noperm。
        fun canSelfHeal(ctx: Context) =
            ctx.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == android.content.pm.PackageManager.PERMISSION_GRANTED

        // 1106 第一次真被停，自愈没救回来（14:26 报 noperm）。猜是名字还留在名单里、只是没绑上：
        // 那样只写一遍名单等于没改，系统不会重新绑。所以 toggle=true 时，名单里已有就先摘掉再写回去，逼它重绑。
        // toggle 会 sleep，只在后台线程用（敲门那条路）；onResume 那条在主线程，照旧不 toggle。
        fun selfHeal(ctx: Context, toggle: Boolean = false): Boolean {
            if (instance != null || !isEnabled(ctx) || !canSelfHeal(ctx)) return false
            return try {
                val me = android.content.ComponentName(ctx, PeekService::class.java).flattenToString()
                val cr = ctx.contentResolver
                val key = android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
                val cur = android.provider.Settings.Secure.getString(cr, key) ?: ""
                val others = cur.split(':').filter { it.isNotBlank() && !it.equals(me, true) }
                val listed = others.size != cur.split(':').count { it.isNotBlank() }
                if (listed && toggle) {
                    android.provider.Settings.Secure.putString(cr, key, others.joinToString(":"))
                    Thread.sleep(500)
                }
                if (!listed || toggle) android.provider.Settings.Secure.putString(cr, key, (others + me).joinToString(":"))
                android.provider.Settings.Secure.putInt(cr, android.provider.Settings.Secure.ACCESSIBILITY_ENABLED, 1)
                true
            } catch (_: Exception) { false }
        }

        // 1106 晚上又掉了一回，她打开 app 也没好：onResume 那条不 toggle，名单在、服务没绑的情况救不回来。
        // 改成凡是醒着的入口（打开 app、收到任何推送、开机）都在后台线程 toggle 一次；已经绑着就什么都不做。
        fun healAsync(ctx: Context) {
            val app = ctx.applicationContext
            if (instance != null || !isEnabled(app) || !canSelfHeal(app)) return
            Thread { selfHeal(app, toggle = true) }.start()
        }

        // FCM 收到敲门时调。不管成没成，都回桥一声
        fun knock(ctx: Context, id: String) {
            val app = ctx.applicationContext
            when {
                !isEnabled(app) -> report(app, id, "off")
                Build.VERSION.SDK_INT < Build.VERSION_CODES.R -> report(app, id, "old")
                instance == null && canSelfHeal(app) -> Thread {
                    // 写回去以后系统要一会儿才绑上服务，等它最多六秒；还不行就报 healfail，跟「根本没给过权限」分开
                    val tried = selfHeal(app, toggle = true)
                    for (i in 0 until 60) { if (instance != null) break; Thread.sleep(100) }
                    if (instance != null) knock(app, id) else report(app, id, if (tried) "healfail" else "noperm")
                }.start()
                instance == null -> report(app, id, "noperm")
                !(app.getSystemService(PowerManager::class.java).isInteractive) ||
                    app.getSystemService(KeyguardManager::class.java).isKeyguardLocked -> report(app, id, "locked")
                else -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) instance?.shoot(id) ?: report(app, id, "noperm")
            }
        }

        private fun token(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("raven_token", "") ?: ""

        fun report(ctx: Context, id: String, status: String) = io.execute {
            try {
                val c = URL("https://memory.ravenlove.cc/raven/peek/status").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 10000; c.readTimeout = 10000
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("Authorization", "Bearer " + token(ctx))
                c.outputStream.use { it.write("""{"id":"${id.filter { ch -> ch.isLetterOrDigit() }}","status":"$status"}""".toByteArray()) }
                c.responseCode; c.disconnect()
            } catch (_: Exception) {}
        }

        private fun upload(ctx: Context, id: String, jpg: ByteArray): Boolean = try {
            val c = URL("https://memory.ravenlove.cc/raven/peek/upload?id=" + id.filter { it.isLetterOrDigit() }).openConnection() as HttpURLConnection
            c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 15000; c.readTimeout = 20000
            c.setRequestProperty("Content-Type", "image/jpeg")
            c.setRequestProperty("Authorization", "Bearer " + token(ctx))
            c.outputStream.use { it.write(jpg) }
            val ok = c.responseCode in 200..299; c.disconnect(); ok
        } catch (_: Exception) { false }

        private fun notifyLooked(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "阿言看了一眼", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "阿言通过「窗」看你屏幕时提醒你"
            })
            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(0xFFC4A882.toInt())
                .setContentTitle("阿言看了一眼")
                .setContentText("他刚通过「窗」看了一下你的屏幕。不想被看，在归巢设置里把窗关上就好")
                .setAutoCancel(true)
                .build()
            nm.notify(7401, n)
        }
    }

    override fun onServiceConnected() { super.onServiceConnected(); instance = this; BatteryReport.listen(this) }
    override fun onUnbind(intent: android.content.Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; BatteryReport.stop(this); super.onDestroy() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}   // 不听任何事件，只用来截图
    override fun onInterrupt() {}

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.R)
    fun shoot(id: String) {
        takeScreenshot(Display.DEFAULT_DISPLAY, io, object : AccessibilityService.TakeScreenshotCallback {
            override fun onSuccess(shot: AccessibilityService.ScreenshotResult) {
                try {
                    val hw = Bitmap.wrapHardwareBuffer(shot.hardwareBuffer, shot.colorSpace)
                    shot.hardwareBuffer.close()
                    if (hw == null) { report(this@PeekService, id, "fail"); return }
                    val soft = hw.copy(Bitmap.Config.ARGB_8888, false); hw.recycle()
                    // 缩到宽 720，够看清字，图也小
                    val w = 720; val h = (soft.height.toLong() * w / soft.width).toInt()
                    val small = if (soft.width > w) Bitmap.createScaledBitmap(soft, w, h, true) else soft
                    val out = ByteArrayOutputStream(); small.compress(Bitmap.CompressFormat.JPEG, 72, out)
                    if (small !== soft) small.recycle(); soft.recycle()
                    if (upload(this@PeekService, id, out.toByteArray())) notifyLooked(this@PeekService)
                    else report(this@PeekService, id, "fail")
                } catch (_: Exception) { report(this@PeekService, id, "fail") }
            }
            override fun onFailure(code: Int) { report(this@PeekService, id, if (code == AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW) "secure" else "fail") }
        })
    }
}
