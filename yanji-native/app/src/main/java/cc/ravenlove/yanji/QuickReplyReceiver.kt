package cc.ravenlove.yanji

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput
import kotlinx.coroutines.*
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class QuickReplyReceiver : BroadcastReceiver() {

    companion object {
        private const val KEY_REPLY = "key_quick_reply"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val bundle = RemoteInput.getResultsFromIntent(intent) ?: return
        val replyText = bundle.getCharSequence(KEY_REPLY)?.toString()?.trim() ?: return
        if (replyText.isEmpty()) return

        // 清除通知
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.cancelAll()

        // 异步发送消息到归巢
        val prefs = context.getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
        val token = prefs.getString("raven_token", "") ?: ""

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = URL("https://memory.ravenlove.cc/raven/chat")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                if (token.isNotEmpty()) {
                    conn.setRequestProperty("Authorization", "Bearer $token")
                }
                conn.doOutput = true
                val body = """{"text":"${replyText.replace("\"", "\\\"")}"}"""
                OutputStreamWriter(conn.outputStream).use { it.write(body) }
                conn.responseCode // trigger
                conn.disconnect()
            } catch (_: Exception) {}
        }
    }
}
