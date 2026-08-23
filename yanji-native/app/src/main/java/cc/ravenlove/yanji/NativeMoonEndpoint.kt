package cc.ravenlove.yanji

import java.net.URI

object NativeMoonEndpoint {
    fun normalize(raw: String?): String? {
        val value = raw?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() } ?: return null
        return try {
            val uri = URI(value)
            if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null ||
                uri.query != null || uri.fragment != null) null else value
        } catch (_: Exception) {
            null
        }
    }

    fun callAnswer(baseUrl: String): String = "$baseUrl/call/answer"
}
