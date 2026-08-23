package cc.ravenlove.yanji

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeMoonEndpointTest {
    @Test fun acceptsHttpsWithoutCredentialsAndNormalizesTrailingSlash() {
        assertEquals("https://fixture.example/api", NativeMoonEndpoint.normalize("https://fixture.example/api/"))
        assertEquals(
            "https://fixture.example/api/call/answer",
            NativeMoonEndpoint.callAnswer("https://fixture.example/api")
        )
    }

    @Test fun rejectsCleartextCredentialsAndAmbiguousUrls() {
        assertNull(NativeMoonEndpoint.normalize("http://fixture.example"))
        assertNull(NativeMoonEndpoint.normalize("https://fixture-user@fixture.example"))
        assertNull(NativeMoonEndpoint.normalize("https://fixture.example?target=other"))
        assertNull(NativeMoonEndpoint.normalize("not a url"))
    }
}
