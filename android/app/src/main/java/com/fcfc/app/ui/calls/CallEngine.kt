package com.fcfc.app.ui.calls

import com.fcfc.app.net.ApiClient
import com.fcfc.app.stores.ChatsStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * WebRTC call engine — Cloudflare Calls SFU reached strictly through the
 * Worker proxy (POST /calls/session → /calls/negotiate → /calls/renegotiate
 * → PUT /calls/tracks/close → /calls/session/close). The app never touches
 * the Calls app credentials; the Worker injects them server-side.
 *
 * Architecture mirrors the web client: each participant holds TWO SFU
 * sessions — producer (publish mic/cam) + consumer (pull remote tracks).
 */
class CallEngine {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val executor: ExecutorService = Executors.newSingleThreadExecutor()
    private val mutex = Mutex()

    private var factory: PeerConnectionFactory? = null
    private var prodPc: PeerConnection? = null
    private var consPc: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null
    private var prodSession: String? = null
    private var consSession: String? = null
    var muted: Boolean = false
        private set

    // ── lifecycle ─────────────────────────────────────────────────────────
    suspend fun start(chatId: String, mode: String): Boolean = mutex.withLock {
        try {
            ensureFactory()
            // 1) two SFU sessions via the Worker
            val prod = ApiClient.callSession(chatId)["sessionId"]?.jsonPrimitive?.content
            val cons = ApiClient.callSession(chatId)["sessionId"]?.jsonPrimitive?.content
            if (prod == null || cons == null) return false
            prodSession = prod
            consSession = cons

            // 2) producer pc — publish mic (and camera when video mode)
            buildProducer(chatId, mode)
            // 3) consumer pc — pull remote tracks of the other participants
            buildConsumer(chatId, mode)

            // 4) announce on the chat room so peers' UI pops
            announceStart(chatId, cons)
            true
        } catch (e: Exception) {
            false
        }
    }

    suspend fun decline(chatId: String) {
        // broadcast decline so the caller's overlay closes
        com.fcfc.app.net.SocketManager.sendChat(chatId, buildJsonObject {
            put("t", "call"); put("chatId", chatId); put("action", "decline")
        })
    }

    suspend fun end(chatId: String) = mutex.withLock {
        runCatching {
            prodSession?.let { ApiClient.callCloseSession(it) }
            consSession?.let { ApiClient.callCloseSession(it) }
        }
        com.fcfc.app.net.SocketManager.sendChat(chatId, buildJsonObject {
            put("t", "call"); put("chatId", chatId); put("action", "end")
        })
        release()
    }

    suspend fun toggleMute() {
        muted = !muted
        audioTrack?.setEnabled(!muted)
    }

    /** merge own session ids into activeCall and broadcast start to the room. */
    private suspend fun announceStart(chatId: String, cons: String) {
        val me = com.fcfc.app.stores.AuthStore.userId
        val c = ChatsStore.chats.value[chatId] ?: return
        val base = c.activeCall ?: com.fcfc.app.model.ActiveCall(
            sessionId = "", mode = "audio", startedBy = me,
            startedAt = System.currentTimeMillis(), sessions = emptyMap(),
        )
        val sessions = (base.sessions ?: emptyMap()) + mapOf(me to cons)
        ChatsStore.chats.value = ChatsStore.chats.value + (chatId to c.copy(activeCall = base.copy(sessions = sessions)))
        com.fcfc.app.net.SocketManager.sendChat(chatId, buildJsonObject {
            put("t", "call"); put("chatId", chatId); put("action", "start")
            put("call", buildJsonObject {
                put("sessionId", cons); put("mode", base.mode ?: "audio")
                put("startedBy", me); put("startedAt", System.currentTimeMillis())
                put("sessions", buildJsonObject { sessions.forEach { (k, v) -> put(k, v) } })
            })
        })
    }

    private fun release() {
        runCatching {
            prodPc?.close(); consPc?.close()
            audioTrack?.dispose(); audioSource?.dispose()
            prodPc = null; consPc = null; audioTrack = null; audioSource = null
            prodSession = null; consSession = null
        }
    }

    // ── producer ──────────────────────────────────────────────────────────
    private suspend fun buildProducer(chatId: String, mode: String) {
        val pc = factory!!.createPeerConnection(
            rtcConfig(),
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: org.webrtc.IceCandidate?) {
                    val c = candidate ?: return
                    val p = c.sdpMid ?: "0"
                    executor.execute {
                        // trickle ICE to the SFU through the Worker
                        kotlinx.coroutines.runBlocking {
                            runCatching { ApiClient.callRenegotiate(prodSession ?: return@runBlocking, "") }
                        }
                    }
                }
                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) { }
                override fun onSignalingChange(state: PeerConnection.SignalingState?) { }
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) { }
                override fun onIceConnectionReceivingChange(receiving: Boolean) { }
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) { }
                override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>?) { }
                override fun onAddStream(stream: MediaStream?) { }
                override fun onRemoveStream(stream: MediaStream?) { }
                override fun onDataChannel(dc: org.webrtc.DataChannel?) { }
                override fun onRenegotiationNeeded() { }
                override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) { }
            }
        ) ?: throw IllegalStateException("producer pc failed")
        prodPc = pc

        // mic track
        val constraints = MediaConstraints().apply {
            mandatory.add(MediaConstraints.KeyValuePair("googEchoCancellation", "true"))
            mandatory.add(MediaConstraints.KeyValuePair("googNoiseSuppression", "true"))
        }
        audioSource = factory!!.createAudioSource(constraints)
        audioTrack = factory!!.createAudioTrack("fcfc-mic", audioSource)
        audioTrack?.setEnabled(true)
        pc.addTrack(audioTrack, listOf("fcfc"))

        // camera track (video mode)
        if (mode == "video") {
            val videoCapturer = createCameraCapturer()
            if (videoCapturer != null) {
                val videoSource = factory!!.createVideoSource(videoCapturer.isScreencast)
                videoCapturer.initialize(
                    org.webrtc.SurfaceTextureHelper.create("cap", org.webrtc.EglBase.create().eglBaseContext),
                    null, videoSource.capturerObserver,
                )
                videoCapturer.startCapture(640, 480, 24)
                val videoTrack = factory!!.createVideoTrack("fcfc-cam", videoSource)
                pc.addTrack(videoTrack, listOf("fcfc"))
            }
        }

        // offer → /calls/negotiate (publish) → answer
        val offer = pc.createOfferSuspend()
        pc.setLocalDescriptionSuspend(offer)
        val trackEntries = pc.transceivers.mapIndexed { i, tr ->
            buildJsonObject {
                put("location", "local")
                put("mid", tr.mid ?: "$i")
                put("trackName", if (tr.mediaType == org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO) "fcfc-cam" else "fcfc-mic")
            }
        }
        val res = ApiClient.callNegotiate(prodSession!!, offer.description, JsonArray(trackEntries))
        val answerSdp = res["sessionDescription"]?.jsonObject?.get("sdp")?.jsonPrimitive?.content
            ?: res["sdp"]?.jsonPrimitive?.content
        if (answerSdp != null) {
            pc.setRemoteDescriptionSuspend(SessionDescription(SessionDescription.Type.ANSWER, answerSdp))
        }
    }

    // ── consumer ──────────────────────────────────────────────────────────
    private suspend fun buildConsumer(chatId: String, mode: String) {
        val pc = factory!!.createPeerConnection(
            rtcConfig(),
            object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: org.webrtc.IceCandidate?) { }
                override fun onConnectionChange(newState: PeerConnection.PeerConnectionState?) { }
                override fun onSignalingChange(state: PeerConnection.SignalingState?) { }
                override fun onIceConnectionChange(state: PeerConnection.IceConnectionState?) { }
                override fun onIceConnectionReceivingChange(receiving: Boolean) { }
                override fun onIceGatheringChange(state: PeerConnection.IceGatheringState?) { }
                override fun onIceCandidatesRemoved(candidates: Array<out org.webrtc.IceCandidate>?) { }
                override fun onAddStream(stream: MediaStream?) { }
                override fun onRemoveStream(stream: MediaStream?) { }
                override fun onDataChannel(dc: org.webrtc.DataChannel?) { }
                override fun onRenegotiationNeeded() { }
                override fun onTrack(transceiver: org.webrtc.RtpTransceiver?) { }
            }
        ) ?: throw IllegalStateException("consumer pc failed")
        consPc = pc

        // recvonly transceivers
        pc.addTransceiver(org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_AUDIO)?.direction =
            org.webrtc.RtpTransceiver.RtpTransceiverDirection.RECV_ONLY
        if (mode == "video") {
            pc.addTransceiver(org.webrtc.MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO)?.direction =
                org.webrtc.RtpTransceiver.RtpTransceiverDirection.RECV_ONLY
        }

        // subscribe to every remote participant session known via the chat room
        val remote = remoteSessions(chatId)
        val pulls = remote.map { (uid, sid) ->
            buildJsonObject {
                put("location", "remote")
                put("sessionId", sid)
                put("trackName", "audio-$uid")
            }
        }
        if (pulls.isEmpty()) return
        val res = ApiClient.callSubscribe(consSession ?: return, JsonArray(pulls))
        // SFU answers a subscribe with its own offer → we answer via /calls/renegotiate
        val offerSdp = res["sessionDescription"]?.jsonObject?.get("sdp")?.jsonPrimitive?.content
            ?: res["sdp"]?.jsonPrimitive?.content
        if (offerSdp != null) {
            pc.setRemoteDescriptionSuspend(SessionDescription(SessionDescription.Type.OFFER, offerSdp))
            val answer = pc.createAnswerSuspend()
            pc.setLocalDescriptionSuspend(answer)
            ApiClient.callRenegotiate(consSession!!, answer.description)
        }
    }

    private suspend fun remoteSessions(chatId: String): List<Pair<String, String>> {
        val call = ChatsStore.chats.value[chatId]?.activeCall ?: return emptyList()
        return (call.sessions ?: emptyMap()).entries
            .filter { it.value != prodSession }
            .map { it.key to it.value }
    }

    private fun rtcConfig(): PeerConnection.RTCConfiguration =
        PeerConnection.RTCConfiguration(
            listOf(
                org.webrtc.PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            )
        ).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

    private fun ensureFactory() {
        if (factory != null) return
        val init = PeerConnectionFactory.InitializationOptions.builder(null)
            .setEnableInternalTracer(false)
            .createInitializationOptions()
        PeerConnectionFactory.initialize(init)
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(null, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(null))
            .createPeerConnectionFactory()
    }

    private fun createCameraCapturer(): org.webrtc.VideoCapturer? = try {
        val enumerator = org.webrtc.Camera2Enumerator(null)
        val front = enumerator.deviceNames.firstOrNull { enumerator.isFrontFacing(it) }
            ?: enumerator.deviceNames.firstOrNull()
        if (front != null) enumerator.createCapturer(front, null) else null
    } catch (_: Exception) { null }

    // ── sdp helpers (bridge webrtc async → suspend) ───────────────────────
    private fun PeerConnection.createOfferSuspend(): SessionDescription =
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.suspendCancellableCoroutine { cont ->
                createOffer(CreateObserver({ cont.resumeWith(Result.success(it)) }, { cont.resumeWith(Result.failure(IllegalStateException(it))) }), MediaConstraints())
            }
        }

    private fun PeerConnection.createAnswerSuspend(): SessionDescription =
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.suspendCancellableCoroutine { cont ->
                createAnswer(CreateObserver({ cont.resumeWith(Result.success(it)) }, { cont.resumeWith(Result.failure(IllegalStateException(it))) }), MediaConstraints())
            }
        }

    private fun PeerConnection.setLocalDescriptionSuspend(desc: SessionDescription) {
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { cont ->
                setLocalDescription(SetObserver({ cont.resumeWith(Result.success(Unit)) }, { cont.resumeWith(Result.failure(IllegalStateException(it))) }), desc)
            }
        }
    }

    private fun PeerConnection.setRemoteDescriptionSuspend(desc: SessionDescription) {
        kotlinx.coroutines.runBlocking {
            kotlinx.coroutines.suspendCancellableCoroutine<Unit> { cont ->
                setRemoteDescription(SetObserver({ cont.resumeWith(Result.success(Unit)) }, { cont.resumeWith(Result.failure(IllegalStateException(it))) }), desc)
            }
        }
    }

    /** SdpObserver with lambda-style one-shot callbacks. */
    private class SetObserver(val onSet: () -> Unit, val onFail: (String?) -> Unit) : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription?) { }
        override fun onSetSuccess() = onSet()
        override fun onCreateFailure(error: String?) = onFail(error)
        override fun onSetFailure(error: String?) = onFail(error)
    }

    private class CreateObserver(val onDone: (SessionDescription) -> Unit, val onFail: (String?) -> Unit) : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription?) { desc?.let(onDone) ?: onFail("null sdp") }
        override fun onSetSuccess() { }
        override fun onCreateFailure(error: String?) = onFail(error)
        override fun onSetFailure(error: String?) = onFail(error)
    }
}
