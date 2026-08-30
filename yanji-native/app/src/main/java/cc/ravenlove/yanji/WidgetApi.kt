package cc.ravenlove.yanji

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object WidgetApi {
    private const val BASE = "https://memory.ravenlove.cc"

    fun token(context: Context): String = context
        .getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
        .getString("moon_token", "") ?: ""

    fun request(context: Context, path: String, method: String = "GET", body: JSONObject? = null): String {
        val token = token(context)
        if (token.isEmpty()) throw IllegalStateException("missing token")
        val conn = URL("$BASE$path").openConnection() as HttpURLConnection
        return try {
            conn.requestMethod = method
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.connectTimeout = 8_000
            conn.readTimeout = 8_000
            if (body != null) {
                conn.doOutput = true
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw IllegalStateException("HTTP $code: ${text.take(80)}")
            text
        } finally {
            conn.disconnect()
        }
    }
}
