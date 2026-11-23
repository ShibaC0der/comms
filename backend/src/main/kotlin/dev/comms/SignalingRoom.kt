package dev.comms

import io.ktor.websocket.Frame
import io.ktor.websocket.WebSocketSession
import io.ktor.websocket.readText
import io.ktor.websocket.send
import java.util.UUID
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import org.slf4j.Logger

internal const val MAX_SIGNAL_BYTES = 64 * 1024

internal class SignalingRoom(private val log: Logger) {
    private val lock = Mutex()
    private val peers = mutableMapOf<String, Peer>()

    suspend fun serve(session: WebSocketSession) {
        val id = UUID.randomUUID().toString()
        val peer = Peer(session)
        val writer = session.launch {
            for (message in peer.messages) {
                session.send(message)
            }
        }

        try {
            for (frame in session.incoming) {
                if (frame !is Frame.Text || frame.data.size > MAX_SIGNAL_BYTES) continue
                val message = try {
                    Json.parseToJsonElement(frame.readText()) as? JsonObject ?: continue
                } catch (_: IllegalArgumentException) {
                    continue
                }
                when (message["type"]) {
                    JsonPrimitive("join"), JsonPrimitive("rename") -> updateName(id, peer, message)
                    JsonPrimitive("signal") -> if (peer.displayName != null) routeSignal(id, message)
                    else -> continue
                }
            }
        } finally {
            withContext(NonCancellable) {
                val removed = lock.withLock {
                    if (peers.remove(id) == null) return@withLock false
                    notifyPeers("peer-left", id)
                    true
                }
                if (removed) log.info("Signaling peer left: {}", id)
            }
            peer.messages.cancel()
            writer.cancel()
        }
    }

    private suspend fun updateName(id: String, peer: Peer, message: JsonObject) {
        val joining = message["type"] == JsonPrimitive("join")
        val name = (message["displayName"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.trim()
        lock.withLock {
            if (name.isNullOrEmpty() || joining != (peer.displayName == null)) {
                peer.enqueue(buildJsonObject {
                    put("type", "error")
                    put("message", if (name.isNullOrEmpty()) "Введите имя участника." else "Запрос недоступен.")
                }.toString())
                return
            }
            peer.displayName = name
            if (joining) {
                peer.enqueue(buildJsonObject {
                    put("type", "welcome")
                    put("selfId", id)
                    put("displayName", name)
                    putJsonArray("peers") {
                        for ((peerId, member) in peers) add(buildJsonObject {
                            put("peerId", peerId)
                            put("displayName", member.displayName)
                        })
                    }
                }.toString())
                notifyPeers("peer-joined", id, name)
                peers[id] = peer
                log.info("Signaling peer joined: {}", id)
            } else {
                notifyPeers("peer-renamed", id, name)
            }
        }
    }

    private suspend fun routeSignal(from: String, message: JsonObject) {
        val to = (message["to"] as? JsonPrimitive)?.takeIf { it.isString }?.content ?: return
        if (to == from) return
        val data = message["data"] as? JsonObject ?: return
        when (data["type"]) {
            JsonPrimitive("description") -> {
                val description = data["description"] as? JsonObject ?: return
                val type = description["type"]
                if (type != JsonPrimitive("offer") && type != JsonPrimitive("answer")) return
                if ((description["sdp"] as? JsonPrimitive)?.isString != true) return
            }
            JsonPrimitive("candidate") -> if (data["candidate"] !is JsonObject) return
            else -> return
        }

        val forwarded = buildJsonObject {
            put("type", "signal")
            put("from", from)
            put("data", data)
        }.toString()
        lock.withLock {
            peers[to]?.enqueue(forwarded)
        }
    }

    private fun notifyPeers(type: String, id: String, displayName: String? = null) {
        val message = buildJsonObject {
            put("type", type)
            put("peerId", id)
            if (displayName != null) put("displayName", displayName)
        }.toString()
        peers.values.forEach { it.enqueue(message) }
    }

    private class Peer(private val session: WebSocketSession) {
        var displayName: String? = null
        val messages = Channel<String>(capacity = 64)

        fun enqueue(message: String) {
            if (messages.trySend(message).isFailure) {
                session.cancel("Signaling queue is full")
            }
        }
    }
}
