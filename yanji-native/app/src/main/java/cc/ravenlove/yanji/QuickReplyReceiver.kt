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

        // ⚠️ 0726 修：原来发的是 /raven/chat——这个地址在 raven-bridge 里根本不存在，
        // 所以言叽的通知栏回复从上线起就是死的（404 + 异常被 catch 静默吞掉，零迹象）。
        // 换成新的 /raven/send。token 走 body（服务端就是这么校验的），
        // raven_token 这个 key 目前仍然没人写，等前端同步进来才会真正带上。
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val url = URL("https://memory.ravenlove.cc/raven/send")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                conn.doOutput = true
                // 只转义引号是不够的：换行/反斜杠会让服务端 JSON.parse 失败，而失败是静默的
                fun esc(s: String) = s.replace("\\", "\\\\").replace("\"", "\\\"")
                    .replace("\n", "\\n").replace("\r", "\\r").replace("\t", "\\t")
                val body = """{"text":"${esc(replyText)}","token":"${esc(token)}"}"""
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
                conn.responseCode // trigger
                conn.disconnect()
            } catch (_: Exception) {}
        }
    }
}
