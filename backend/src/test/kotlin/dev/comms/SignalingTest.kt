package dev.comms

import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocketSession
import io.ktor.server.testing.testApplication
import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.close
import io.ktor.websocket.readText
import io.ktor.websocket.send
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

class SignalingTest {
    @Test
    fun `room tracks membership and routes signals only to their recipient`() = testApplication {
        application { module() }
        val browser = createClient { install(WebSockets) }

        withTimeout(5_000) {
            val first = browser.webSocketSession("/ws")
            first.send("""{"type":"join","displayName":"  "}""")
            assertEquals("error", first.receiveMessage().string("type"))
            first.join(" Аня ")
            val firstWelcome = first.receiveMessage()
            assertEquals("welcome", firstWelcome.string("type"))
            assertEquals("Аня", firstWelcome.string("displayName"))
            val firstId = firstWelcome.string("selfId")
            assertEquals(JsonArray(emptyList()), firstWelcome["peers"])

            val second = browser.webSocketSession("/ws")
            second.join("Аня")
            val secondWelcome = second.receiveMessage()
            val secondId = secondWelcome.string("selfId")
            assertNotEquals(firstId, secondId)
            assertEquals(JsonArray(listOf(participant(firstId, "Аня"))), secondWelcome["peers"])
            assertEquals(
                Json.parseToJsonElement("""{"type":"peer-joined","peerId":"$secondId","displayName":"Аня"}"""),
                first.receiveMessage(),
            )

            second.send("""{"type":"rename","peerId":"$firstId","displayName":" Оля "}""")
            val renamed = Json.parseToJsonElement("""{"type":"peer-renamed","peerId":"$secondId","displayName":"Оля"}""")
            assertEquals(renamed, second.receiveMessage())
            assertEquals(renamed, first.receiveMessage())
            second.send("""{"type":"rename","displayName":" "}""")
            assertEquals("error", second.receiveMessage().string("type"))

            val third = browser.webSocketSession("/ws")
            third.join("Лена")
            val thirdWelcome = third.receiveMessage()
            val thirdId = thirdWelcome.string("selfId")
            assertEquals(JsonArray(listOf(participant(firstId, "Аня"), participant(secondId, "Оля"))), thirdWelcome["peers"])
            assertEquals(thirdId, first.receiveMessage().string("peerId"))
            assertEquals(thirdId, second.receiveMessage().string("peerId"))

            val offer = """{"type":"description","description":{"type":"offer","sdp":"test"}}"""
            third.send("invalid json")
            third.send("""{"type":"signal","to":"$firstId","data":{"type":"description"}}""")
            third.send("""{"type":"signal","to":"missing","data":$offer}""")
            third.send("""{"type":"signal","to":"$thirdId","data":$offer}""")
            third.send("""{"type":"signal","to":"$firstId","from":"spoofed","data":$offer}""")
            assertEquals(
                Json.parseToJsonElement("""{"type":"signal","from":"$thirdId","data":$offer}"""),
                first.receiveMessage(),
            )

            third.close()
            val left = Json.parseToJsonElement("""{"type":"peer-left","peerId":"$thirdId"}""")
            assertEquals(left, first.receiveMessage())
            assertEquals(left, second.receiveMessage())

            second.close()
            assertEquals(secondId, first.receiveMessage().string("peerId"))
            val next = browser.webSocketSession("/ws")
            next.join("Лена")
            assertEquals(JsonArray(listOf(participant(firstId, "Аня"))), next.receiveMessage()["peers"])
            first.close()
            assertEquals(firstId, next.receiveMessage().string("peerId"))
            next.close()
        }
    }
}

private suspend fun WebSocketSession.receiveMessage(): JsonObject =
    Json.parseToJsonElement((incoming.receive() as Frame.Text).readText()).jsonObject

private fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content

private suspend fun WebSocketSession.join(name: String) =
    send(buildJsonObject { put("type", "join"); put("displayName", name) }.toString())

private fun participant(id: String, name: String) = buildJsonObject {
    put("peerId", id)
    put("displayName", name)
}
