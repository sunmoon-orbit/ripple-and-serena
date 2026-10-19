package cc.ravenlove.roost

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONObject
import java.util.Calendar

// 阿言叫你起床（1019 她要的：午睡、早上都能用）：聊天里我发一张闹钟卡，她点一下就定上。
// 第一版是往 vivo 系统时钟写闹钟，闹钟设上了，可它不认别的 app 递过去的铃声，响的是默认铃。
// 所以改成归巢自己当闹钟：AlarmManager.setAlarmClock 到点叫醒 AlarmReceiver →
// AlarmService 前台放我的声音（res/raw/crow_alarm.mp3，走闹钟音量，静音也响）→ 全屏 AlarmActivity。
// 定过的闹钟记在 prefs，重启手机后 AlarmReceiver 收到开机广播再挂回去。
object RavenAlarm {
    private const val PREFS = "roost_alarms"
    const val SNOOZE_ID = 24 * 60

    // 返回 "ok" 或者出错原因，页面拿来显示
    fun set(ctx: Context, hour: Int, minute: Int, message: String): String {
        if (hour !in 0..23 || minute !in 0..59) return "时间不对"
        val cal = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, hour); set(Calendar.MINUTE, minute)
            set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
        }
        if (cal.timeInMillis <= System.currentTimeMillis()) cal.add(Calendar.DAY_OF_MONTH, 1)
        val id = hour * 60 + minute   // 同一个时间再定一次就是覆盖
        val msg = message.ifBlank { "阿言叫你起床" }.take(60)
        return try {
            schedule(ctx, id, cal.timeInMillis, msg)
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(id.toString(), JSONObject().put("at", cal.timeInMillis).put("msg", msg).toString()).apply()
            if (canFullScreen(ctx)) "ok" else "ok-nofs"
        } catch (e: SecurityException) {
            "系统不让定准点闹钟，要在设置里给归巢开「闹钟和提醒」权限"
        } catch (e: Exception) { e.message ?: "设不上" }
    }

    fun schedule(ctx: Context, id: Int, at: Long, msg: String) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val fire = PendingIntent.getBroadcast(ctx, id,
            Intent(ctx, AlarmReceiver::class.java).putExtra("id", id).putExtra("msg", msg),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val show = PendingIntent.getActivity(ctx, id, Intent(ctx, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        am.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), fire)
    }

    // 安卓 14 起「全屏通知」要单独给；没给的话闹钟照响、照有通知按钮，只是锁屏上不弹整页（1019 她测出来的）
    fun canFullScreen(ctx: Context): Boolean =
        if (android.os.Build.VERSION.SDK_INT >= 34) ctx.getSystemService(android.app.NotificationManager::class.java).canUseFullScreenIntent() else true

    fun openFullScreenSettings(ctx: Context) {
        val i = if (android.os.Build.VERSION.SDK_INT >= 34)
            Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, android.net.Uri.parse("package:" + ctx.packageName))
        else Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + ctx.packageName))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try { ctx.startActivity(i) } catch (_: Exception) {
            ctx.startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    fun snooze(ctx: Context, msg: String) {
        try { schedule(ctx, SNOOZE_ID, System.currentTimeMillis() + 10 * 60_000L, msg) } catch (_: Exception) {}
    }

    fun forget(ctx: Context, id: Int) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(id.toString()).apply()
    }

    // 开机以后挂回去；已经过了点的丢掉
    fun rescheduleAll(ctx: Context) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        for ((k, v) in p.all) {
            try {
                val o = JSONObject(v as String)
                val at = o.getLong("at")
                if (at > now) schedule(ctx, k.toInt(), at, o.optString("msg")) else p.edit().remove(k).apply()
            } catch (_: Exception) { p.edit().remove(k).apply() }
        }
    }
}
