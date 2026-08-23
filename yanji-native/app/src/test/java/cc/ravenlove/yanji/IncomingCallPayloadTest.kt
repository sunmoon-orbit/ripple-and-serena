package cc.ravenlove.yanji

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class IncomingCallPayloadTest {
    @Test fun newPayloadUsesCallIdAndStableConversationId() {
        val payload = IncomingCallPayload.from(mapOf(
            "type" to "incoming_call", "callId" to "41", "inviteId" to "legacy",
            "expiresAt" to "fixture-expiry", "conversationId" to "9",
            "conversationExternalId" to "fixture-chat"
        ), "fixture title", "fixture reason")
        assertNotNull(payload)
        assertEquals("41", payload?.callId)
        assertEquals("fixture-chat", payload?.conversationExternalId)
        assertEquals("9", payload?.conversationId)
        assertEquals("fixture-expiry", payload?.expiresAt)
    }

    @Test fun legacyPayloadUsesInviteIdAndSharesTheSameParser() {
        val payload = IncomingCallPayload.from(
            mapOf("type" to "call", "inviteId" to "42"), "fixture title", "fixture reason"
        )
        assertEquals("42", payload?.callId)
        assertEquals("fixture reason", payload?.reason)
    }

    @Test fun titleFallbackOnlyAppliesWhenTypeIsAbsent() {
        assertNotNull(IncomingCallPayload.from(emptyMap(), "涟言来电话了", "fixture reason"))
        assertNull(IncomingCallPayload.from(mapOf("type" to "proactive_message"), "涟言来电话了", "fixture"))
    }
}
