package cc.ravenlove.yanji

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != IntentIdentity.ACTION_CALL_ANSWER &&
            intent.action != IntentIdentity.ACTION_CALL_DECLINE) return

        val callId = intent.getStringExtra(CallActivity.EXTRA_CALL_ID)
        context.sendBroadcast(Intent(CallActivity.ACTION_STOP_CALL).apply {
            setPackage(context.packageName)
            putExtra(CallActivity.EXTRA_CALL_ID, callId)
        })
        val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        mgr.cancel(YanjiFCMService.CALL_NOTIFICATION_ID)

        if (intent.action == IntentIdentity.ACTION_CALL_ANSWER) {
            context.startActivity(Intent(context, MainActivity::class.java).apply {
                action = IntentIdentity.ACTION_CALL_ANSWER
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                putExtra("call_action", "answer")
                putExtra(CallActivity.EXTRA_CALL_ID, callId)
                putExtra(CallActivity.EXTRA_REASON, intent.getStringExtra(CallActivity.EXTRA_REASON))
                putExtra(CallActivity.EXTRA_EXPIRES_AT, intent.getStringExtra(CallActivity.EXTRA_EXPIRES_AT))
                putExtra(CallActivity.EXTRA_CONVERSATION_ID, intent.getStringExtra(CallActivity.EXTRA_CONVERSATION_ID))
                putExtra(CallActivity.EXTRA_CONVERSATION_EXTERNAL_ID,
                    intent.getStringExtra(CallActivity.EXTRA_CONVERSATION_EXTERNAL_ID))
            })
        } else {
            val pending = goAsync()
            NativeCallActionQueue.enqueueDecline(context, callId) { pending.finish() }
        }
    }
}
