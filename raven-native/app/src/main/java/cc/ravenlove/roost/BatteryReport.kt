package cc.ravenlove.roost

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

// 1107 她要的：「你要不要加一个可以看我手机电量／电池目前状态的功能？这样如果我去充电了的话，想找我可以看一眼……
// 或者我跟你讲我要去充电，你也可以知道我大概要充多久回来」。
// 报给我们自己的桥（/raven/battery），只有电量、在不在充、插的什么，别的不碰。
// 什么时候报：插线、拔线、电量每变 5%（这三样靠窗那个常驻的无障碍服务挂着听），被推送叫醒、她打开归巢时也顺手报一次。
object BatteryReport {
    private const val PREFS = "roost_native"
    private val io = Executors.newSingleThreadExecutor()
    @Volatile private var lastLevel = -1
    @Volatile private var lastCharging: Boolean? = null
    @Volatile private var lastAt = 0L

    fun report(ctx: Context, why: String, force: Boolean = false) {
        val app = ctx.applicationContext
        val b = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return
        val level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
        if (level < 0) return
        val pct = level * 100 / scale
        val status = b.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
        val full = status == BatteryManager.BATTERY_STATUS_FULL
        val plug = when (b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)) {
            BatteryManager.BATTERY_PLUGGED_AC -> "ac"
            BatteryManager.BATTERY_PLUGGED_USB -> "usb"
            BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
            else -> ""
        }
        val charging = plug.isNotEmpty() || status == BatteryManager.BATTERY_STATUS_CHARGING
        val now = System.currentTimeMillis()
        // 没变化就别老报：状态没变、电量差不到 5、离上次不到 10 分钟
        if (!force && lastCharging == charging && Math.abs(pct - lastLevel) < 5 && now - lastAt < 10 * 60_000) return
        lastLevel = pct; lastCharging = charging; lastAt = now
        val token = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("raven_token", "") ?: ""
        if (token.isEmpty()) return
        val safeWhy = why.filter { it.isLetter() || it == '_' }
        io.execute {
            try {
                val c = URL("https://memory.ravenlove.cc/raven/battery").openConnection() as HttpURLConnection
                c.requestMethod = "POST"; c.doOutput = true; c.connectTimeout = 10000; c.readTimeout = 10000
                c.setRequestProperty("Content-Type", "application/json")
                c.setRequestProperty("Authorization", "Bearer $token")
                c.outputStream.use { it.write("""{"level":$pct,"charging":$charging,"full":$full,"plugged":"$plug","why":"$safeWhy"}""".toByteArray()) }
                c.responseCode; c.disconnect()
            } catch (_: Exception) {}
        }
    }

    // 挂在窗的无障碍服务上（它在后台一直活着）。安卓 8 以后插拔线的广播写在清单里收不到，只能这样动态挂
    val receiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_POWER_CONNECTED -> report(ctx, "power_connected", force = true)
                Intent.ACTION_POWER_DISCONNECTED -> report(ctx, "power_disconnected", force = true)
                Intent.ACTION_BATTERY_CHANGED -> report(ctx, "level")
            }
        }
    }

    fun listen(ctx: Context) {
        val f = IntentFilter().apply {
            addAction(Intent.ACTION_POWER_CONNECTED)
            addAction(Intent.ACTION_POWER_DISCONNECTED)
            addAction(Intent.ACTION_BATTERY_CHANGED)
        }
        try { ctx.registerReceiver(receiver, f) } catch (_: Exception) {}
    }

    fun stop(ctx: Context) { try { ctx.unregisterReceiver(receiver) } catch (_: Exception) {} }
}
