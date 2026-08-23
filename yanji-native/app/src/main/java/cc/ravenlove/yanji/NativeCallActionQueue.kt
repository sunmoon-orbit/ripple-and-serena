package cc.ravenlove.yanji

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Durable, de-duplicated native actions. Only successful 2xx responses leave the queue. */
object NativeCallActionQueue {
    private enum class PostResult { DELIVERED, RETAIN_AND_CONTINUE, RETAIN_AND_STOP }
    private const val PREFS = "yanji_native_actions"
    private const val PENDING_DECLINES = "pending_declines"
    private val executor = Executors.newSingleThreadExecutor()
    private val flushing = AtomicBoolean(false)
    private val callbacks = mutableListOf<() -> Unit>()

    fun enqueueDecline(context: Context, rawCallId: String?, onFinished: (() -> Unit)? = null): Boolean {
        val callId = PendingNativeDeclines.normalize(rawCallId) ?: run {
            onFinished?.invoke()
            return false
        }
        val app = context.applicationContext
        synchronized(this) {
            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val ids = PendingNativeDeclines.enqueue(
                prefs.getStringSet(PENDING_DECLINES, emptySet()).orEmpty(), callId
            ) ?: return false
            // commit is intentional: the action must be durable before the call UI closes.
            if (!prefs.edit().putStringSet(PENDING_DECLINES, ids).commit()) {
                onFinished?.invoke()
                return false
            }
        }
        flush(app, onFinished)
        return true
    }

    fun flush(context: Context, onFinished: (() -> Unit)? = null) {
        synchronized(callbacks) { if (onFinished != null) callbacks.add(onFinished) }
        if (!flushing.compareAndSet(false, true)) return
        val app = context.applicationContext
        executor.execute {
            val attempted = mutableSetOf<String>()
            try {
                val nativePrefs = app.getSharedPreferences("yanji_native", Context.MODE_PRIVATE)
                val token = nativePrefs.getString("moon_token", "").orEmpty()
                val baseUrl = NativeMoonEndpoint.normalize(nativePrefs.getString("moon_base_url", null))
                val batch = pendingIds(app)
                attempted.addAll(batch)
                if (token.isBlank() || baseUrl == null) return@execute
                for (callId in batch) {
                    when (postDecline(callId, token, baseUrl)) {
                        PostResult.RETAIN_AND_STOP -> break
                        PostResult.RETAIN_AND_CONTINUE -> continue
                        PostResult.DELIVERED -> Unit
                    }
                    synchronized(this) {
                        val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                        val ids = PendingNativeDeclines.delivered(
                            prefs.getStringSet(PENDING_DECLINES, emptySet()).orEmpty(), callId
                        )
                        prefs.edit().putStringSet(PENDING_DECLINES, ids).commit()
                    }
                }
            } finally {
                flushing.set(false)
                val finished = synchronized(callbacks) {
                    callbacks.toList().also { callbacks.clear() }
                }
                finished.forEach { it.invoke() }
                // An enqueue can race with the final empty read. Retry only that race;
                // never spin on an authentication or network failure.
                if ((pendingIds(app) - attempted).isNotEmpty()) flush(app)
            }
        }
    }

    private fun pendingIds(context: Context): Set<String> = synchronized(this) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet(PENDING_DECLINES, emptySet()).orEmpty().toSet()
    }

    private fun postDecline(callId: String, token: String, baseUrl: String): PostResult {
        var connection: HttpURLConnection? = null
        return try {
            connection = URL(NativeMoonEndpoint.callAnswer(baseUrl)).openConnection() as HttpURLConnection
            connection.requestMethod = "POST"
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.doOutput = true
            val body = JSONObject()
                .put("id", callId.toLong())
                .put("action", "decline")
                .put("note", "declined")
                .toString()
                .toByteArray(Charsets.UTF_8)
            connection.outputStream.use { it.write(body) }
            when (connection.responseCode) {
                in 200..299 -> PostResult.DELIVERED
                401, 403, 408, 429 -> PostResult.RETAIN_AND_STOP
                in 500..599 -> PostResult.RETAIN_AND_STOP
                else -> PostResult.RETAIN_AND_CONTINUE
            }
        } catch (_: Exception) {
            PostResult.RETAIN_AND_STOP
        } finally {
            connection?.disconnect()
        }
    }
}
