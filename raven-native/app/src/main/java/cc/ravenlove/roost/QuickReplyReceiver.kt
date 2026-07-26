package cc.ravenlove.roost

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

    override fun onReceive(context: Context, intent: Intent) {
        val bundle = RemoteInput.getResultsFromIntent(intent) ?: return
        val replyText = bundle.getCharSequence(RoostFCMService.KEY_REPLY)?.toString()?.trim() ?: return
        if (replyText.isEmpty()) return

        context.getSystemService(NotificationManager::class.java).cancelAll()

        // token 由前端登录后经 WebBridge.saveRavenToken 同步进来。
        // ⚠️ 言叽那份抄错过两处：读的 key 从来没人写、发的地址 /raven/chat 根本不存在，
        // 所以它的通知栏回复从上线起就是死的。这里两处都改对了。
        val token = context.getSharedPreferences("roost_native", Context.MODE_PRIVATE)
            .getString("raven_token", "") ?: ""

        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val conn = URL("https://memory.ravenlove.cc/raven/send").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.connectTimeout = 10000
                conn.readTimeout = 10000
                conn.doOutput = true
                val body = JsonEscape.obj(replyText, token)
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
                conn.responseCode
                conn.disconnect()
            } catch (_: Exception) {
            } finally {
                pending.finish()
            }
        }
    }
}

private object JsonEscape {
    // 手拼 JSON 只转义引号是不够的：换行、反斜杠、控制字符都会让服务端 JSON.parse 失败，
    // 而失败是静默的——消息就这么没了（0702 归巢回复静默丢失踩过同款）
    fun obj(text: String, token: String) =
        """{"text":"${esc(text)}","token":"${esc(token)}"}"""

    private fun esc(s: String) = buildString {
        for (c in s) when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
        }
    }
}
