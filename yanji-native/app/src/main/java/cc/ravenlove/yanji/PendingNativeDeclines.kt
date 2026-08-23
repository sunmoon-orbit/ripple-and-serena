package cc.ravenlove.yanji

object PendingNativeDeclines {
    fun normalize(rawCallId: String?): String? =
        rawCallId?.toLongOrNull()?.takeIf { it > 0 }?.toString()

    fun enqueue(current: Set<String>, rawCallId: String?): Set<String>? {
        val callId = normalize(rawCallId) ?: return null
        return current + callId
    }

    fun delivered(current: Set<String>, callId: String): Set<String> = current - callId
}
