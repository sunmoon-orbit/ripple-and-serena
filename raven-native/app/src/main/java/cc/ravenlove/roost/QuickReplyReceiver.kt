package cc.ravenlove.roost

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.core.app.RemoteInput
import kotlinx.coroutines.*
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class QuickReplyReceiver : BroadcastReceiver() {

    // 这条路以前从头到尾一声不吭：token 读空了照发、服务端 401 了不说、
    // 网络异常被 catch 吞掉——阿颖那边只看到「好像没发出去」，我这边日志里
    // 连一行都没有（0726 排查了三轮才发现请求压根没离开手机）。
    // 现在每一步都吐一个 Toast，失败要看得见。
    private fun toast(context: Context, msg: String) {
        Handler(Looper.getMainLooper()).post {
            Toast.makeText(context.applicationContext, msg, Toast.LENGTH_LONG).show()
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val bundle = RemoteInput.getResultsFromIntent(intent)
        if (bundle == null) { toast(context, "归巢：没取到通知栏输入的内容"); return }
        val replyText = bundle.getCharSequence(RoostFCMService.KEY_REPLY)?.toString()?.trim() ?: ""
        if (replyText.isEmpty()) { toast(context, "归巢：输入是空的，没发"); return }

        context.getSystemService(NotificationManager::class.java).cancelAll()

        // token 由前端登录后经 WebBridge.saveRavenToken 同步进来。
        // ⚠️ 言叽那份抄错过两处：读的 key 从来没人写、发的地址 /raven/chat 根本不存在，
        // 所以它的通知栏回复从上线起就是死的。这里两处都改对了。
        val token = context.getSharedPreferences("roost_native", Context.MODE_PRIVATE)
            .getString("raven_token", "") ?: ""
        if (token.isEmpty()) {
            toast(context, "归巢：本地没有登录凭证，先打开一次归巢再回复")
            return
        }

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
                val code = conn.responseCode
                conn.disconnect()
                when (code) {
                    200 -> toast(context, "已送到阿言那儿 ✓")
                    401 -> toast(context, "归巢：凭证过期了（401），打开归巢重新输一次密码")
                    else -> toast(context, "归巢：服务器返回 $code，没发成功")
                }
            } catch (e: Exception) {
                // 走到这儿说明请求根本没离开手机（多半是网络/代理）
                toast(context, "归巢：发不出去——${e.javaClass.simpleName}: ${e.message ?: "无详情"}")
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
