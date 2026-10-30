package cc.ravenlove.roost

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

// 到点了（或者手机刚开机）：开机就把定过的闹钟挂回去；到点就叫 AlarmService 响起来
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) { RavenAlarm.rescheduleAll(ctx); return }
        val id = intent.getIntExtra("id", -1)
        if (id >= 0) RavenAlarm.forget(ctx, id)
        ContextCompat.startForegroundService(ctx,
            Intent(ctx, AlarmService::class.java).putExtra("msg", intent.getStringExtra("msg") ?: "阿言叫你起床").putExtra("id", id))
    }
}
