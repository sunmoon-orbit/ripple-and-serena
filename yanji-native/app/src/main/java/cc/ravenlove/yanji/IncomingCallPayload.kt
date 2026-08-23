package cc.ravenlove.yanji

data class IncomingCallPayload(
    val callId: String?,
    val reason: String,
    val expiresAt: String?,
    val conversationId: String?,
    val conversationExternalId: String?
) {
    companion object {
        fun from(data: Map<String, String>, title: String, body: String): IncomingCallPayload? {
            val type = data["type"]
            val isCall = type == "incoming_call" || type == "call" ||
                (type == null && title == "涟言来电话了")
            if (!isCall) return null
            return IncomingCallPayload(
                callId = data["callId"]?.takeIf { it.isNotBlank() }
                    ?: data["inviteId"]?.takeIf { it.isNotBlank() },
                reason = data["reason"]?.takeIf { it.isNotBlank() } ?: body,
                expiresAt = data["expiresAt"]?.takeIf { it.isNotBlank() },
                conversationId = data["conversationId"]?.takeIf { it.isNotBlank() },
                conversationExternalId = data["conversationExternalId"]?.takeIf { it.isNotBlank() }
            )
        }
    }
}
