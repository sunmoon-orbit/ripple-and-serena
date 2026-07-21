package cc.ravenlove.yanji

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == "cc.ravenlove.yanji.CALL_DECLINE") {
            val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            mgr.cancel(YanjiFCMService.CALL_NOTIFICATION_ID)
        }
    }
}
