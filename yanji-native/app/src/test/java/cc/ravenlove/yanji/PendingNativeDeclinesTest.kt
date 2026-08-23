package cc.ravenlove.yanji

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PendingNativeDeclinesTest {
    @Test fun duplicateDeclinesRemainOnePendingAction() {
        val first = PendingNativeDeclines.enqueue(emptySet(), "51")
        val duplicate = PendingNativeDeclines.enqueue(first.orEmpty(), "51")
        assertEquals(setOf("51"), duplicate)
    }

    @Test fun onlySuccessfulDeliveryRemovesTheMatchingAction() {
        val pending = setOf("51", "52")
        assertEquals(setOf("52"), PendingNativeDeclines.delivered(pending, "51"))
    }

    @Test fun invalidIdsNeverEnterTheQueue() {
        assertNull(PendingNativeDeclines.enqueue(emptySet(), "not-an-id"))
        assertNull(PendingNativeDeclines.enqueue(emptySet(), "0"))
    }
}
