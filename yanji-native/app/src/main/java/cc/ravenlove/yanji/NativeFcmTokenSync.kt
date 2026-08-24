package cc.ravenlove.yanji

import android.content.Context
import android.util.Log
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Keeps the server's FCM token current even when Firebase rotates it while the WebView is closed.
 * Uploads are gated by the user's existing push preference and use only the validated HTTPS Moon
 * endpoint already copied into native preferences.
 */
object NativeFcmTokenSync {
    private const val FCM_PREFS = "yanji_fcm"
    private const val NATIVE_PREFS = "yanji_native"
    private const val TOKEN = "token"
    private const val ENABLED = "enabled"
    private val executor = Executors.newSingleThreadExecutor()

    fun setEnabled(context: Context, enabled: Boolean) {
        val app = context.applicationContext
        app.getSharedPreferences(FCM_PREFS, Context.MODE_PRIVATE)
            .edit().putBoolean(ENABLED, enabled).apply()
        if (enabled) flush(app)
    }

    fun recordToken(context: Context, rawToken: String) {
        val token = rawToken.trim()
        if (token.isEmpty()) return
        val app = context.applicationContext
        app.getSharedPreferences(FCM_PREFS, Context.MODE_PRIVATE)
            .edit().putString(TOKEN, token).apply()
        uploadIfEnabled(app, token)
    }

    fun flush(context: Context) {
        val app = context.applicationContext
        val token = app.getSharedPreferences(FCM_PREFS, Context.MODE_PRIVATE)
            .getString(TOKEN, "").orEmpty().trim()
        if (token.isNotEmpty()) uploadIfEnabled(app, token)
    }

    private fun uploadIfEnabled(context: Context, token: String) {
        if (!isEnabled(context)) return
        executor.execute {
            // The user can turn push off while an upload is waiting in the queue.
            if (!isEnabled(context)) return@execute
            val native = context.getSharedPreferences(NATIVE_PREFS, Context.MODE_PRIVATE)
            val baseUrl = NativeMoonEndpoint.normalize(native.getString("moon_base_url", null))
                ?: return@execute
            val authToken = native.getString("moon_token", "").orEmpty()
            if (authToken.isBlank()) return@execute
            postToken(baseUrl, authToken, token)
        }
    }

    private fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(FCM_PREFS, Context.MODE_PRIVATE)
            .getBoolean(ENABLED, false)

    private fun postToken(baseUrl: String, authToken: String, token: String) {
        var connection: HttpURLConnection? = null
        try {
            connection = URL("$baseUrl/push/fcm-token").openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Authorization", "Bearer $authToken")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.doOutput = true
            val body = JSONObject().put("token", token).toString().toByteArray(Charsets.UTF_8)
            connection.outputStream.use { it.write(body) }
            if (connection.responseCode !in 200..299) {
                Log.w("YanjiFCM", "原生 token 补传失败: HTTP ${connection.responseCode}")
            }
        } catch (e: Exception) {
            Log.w("YanjiFCM", "原生 token 补传失败，保留到下次重试", e)
        } finally {
            connection?.disconnect()
        }
    }
}
