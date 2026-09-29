package com.fcfc.app.crypto

import com.fcfc.app.core.Codec
import com.fcfc.app.db.FcDb
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put

/**
 * 1:1 sessions — port of frontend/src/crypto/{keys,x3dh,ratchet,sessions}.ts.
 * X3DH initiation/reception + Double Ratchet with skipped-message keys,
 * per-peer serialization locks, session persistence in FcDb 'sessions'.
 */
object CryptoSessions {
    private val JSON = Json { ignoreUnknownKeys = true; isLenient = true }

    // ── identity bundle (keys.ts) ─────────────────────────────────────────
    class IdentityMaterial(
        val identity: Primitives.KeyPair,
        val signing: Primitives.KeyPair,
        val signedPrekey: Primitives.KeyPair,
        val spkSig: String,
        val otks: List<Primitives.KeyPair>,
    )

    private const val K_IDENTITY = "identity"
    private const val K_SIGNING = "signing"
    private const val K_SPK = "signedPrekey"
    private const val K_SPKSIG = "spkSig"
    private const val K_OTKS = "otks"

    suspend fun createIdentityBundle(): IdentityMaterial {
        val identity = Primitives.generateDh()
        val signing = Primitives.generateSign()
        val spk = Primitives.generateDh()
        // spkSig = ECDSA over the canonical JSON of spkPub JWK (exact order)
        val spkJwk = spk.pub
        val sig = Primitives.ecdsaSign(signing.priv, Codec.utf8(spkJwk.toString()))
        val spkSig = Codec.b64u(sig)
        val otks = (0 until 20).map { Primitives.generateDh() }
        val bundle = IdentityMaterial(identity, signing, spk, spkSig, otks)
        persistBundle(bundle)
        return bundle
    }

    suspend fun persistBundle(b: IdentityMaterial) {
        FcDb.put("keys", K_IDENTITY, buildJsonObject { put("pub", b.identity.pub); put("priv", b.identity.priv) })
        FcDb.put("keys", K_SIGNING, buildJsonObject { put("pub", b.signing.pub); put("priv", b.signing.priv) })
        FcDb.put("keys", K_SPK, buildJsonObject { put("pub", b.signedPrekey.pub); put("priv", b.signedPrekey.priv) })
        FcDb.put("keys", K_SPKSIG, JsonPrimitive(b.spkSig))
        FcDb.put("keys", K_OTKS, JsonArray(b.otks.map { buildJsonObject { put("pub", it.pub); put("priv", it.priv) } }))
    }

    suspend fun loadIdentityBundle(): IdentityMaterial? {
        val identity = FcDb.get("keys", K_IDENTITY)?.jsonObject ?: return null
        val signing = FcDb.get("keys", K_SIGNING)?.jsonObject ?: return null
        val spk = FcDb.get("keys", K_SPK)?.jsonObject ?: return null
        val spkSig = FcDb.get("keys", K_SPKSIG)?.jsonPrimitive?.content ?: return null
        val otks = (FcDb.get("keys", K_OTKS) as? JsonArray)?.map {
            val o = it.jsonObject
            Primitives.KeyPair(o["pub"]!!.jsonObject, o["priv"]!!.jsonObject)
        } ?: emptyList()
        return IdentityMaterial(
            Primitives.KeyPair(identity["pub"]!!.jsonObject, identity["priv"]!!.jsonObject),
            Primitives.KeyPair(signing["pub"]!!.jsonObject, signing["priv"]!!.jsonObject),
            Primitives.KeyPair(spk["pub"]!!.jsonObject, spk["priv"]!!.jsonObject),
            spkSig, otks,
        )
    }

    fun publicBundleForUpload(b: IdentityMaterial): JsonObject = buildJsonObject {
        put("identityPub", b.identity.pub)
        put("signPub", b.signing.pub)
        put("spkPub", b.signedPrekey.pub)
        put("spkSig", b.spkSig)
        put("otks", JsonArray(b.otks.map { it.pub }))
    }

    fun verifySignedPrekey(spkPub: JsonObject, sig: String, signPub: JsonObject): Boolean = try {
        Primitives.ecdsaVerify(signPub, Codec.utf8(spkPub.toString()), Codec.b64uBytes(sig))
    } catch (_: Exception) { false }

    // ── X3DH (x3dh.ts) ────────────────────────────────────────────────────
    class X3dhResult(
        val rootKey: ByteArray,
        val dh3: ByteArray,           // EKa×SPKb — reused as first ratchet step
        val handshake: JsonObject,    // {ik, ek, opk}
        val ekaPriv: JsonObject,
        val ekaPub: JsonObject,
    )

    fun x3dhInitiate(me: IdentityMaterial, their: JsonObject): X3dhResult {
        val spkPub = their["spkPub"]!!.jsonObject
        val sig = their["spkSig"]?.jsonPrimitive?.contentOrNull ?: ""
        val signPub = their["signPub"]!!.jsonObject
        val identityPub = their["identityPub"]!!.jsonObject
        if (!verifySignedPrekey(spkPub, sig, signPub)) throw IllegalStateException("signed prekey signature invalid")

        val ek = Primitives.generateDh()
        val dh1 = Primitives.dh(me.identity.priv, spkPub)
        val dh2 = Primitives.dh(ek.priv, identityPub)
        val dh3 = Primitives.dh(ek.priv, spkPub)
        val parts = mutableListOf(dh1, dh2, dh3)
        val opkPub = their["opkPub"] as? JsonObject
        if (opkPub != null) parts.add(Primitives.dh(ek.priv, opkPub))
        val rootKey = Primitives.hkdf(ByteArray(32), parts.reduce { a, b -> a + b }, "fcfc-x3dh", 32)
        val handshake = buildJsonObject {
            put("ik", me.identity.pub)
            put("ek", ek.pub)
            opkPub?.let { put("opk", it) }
        }
        return X3dhResult(rootKey, dh3, handshake, ek.priv, ek.pub)
    }

    class X3dhRespondResult(val rootKey: ByteArray, val dh3Shared: ByteArray, val usedOtk: JsonObject?)

    /** Receiver side — handshake must be addressed to us (OTK matched when present). */
    fun x3dhRespond(me: IdentityMaterial, hs: JsonObject): X3dhRespondResult {
        val ikA = hs["ik"]!!.jsonObject
        val ekA = hs["ek"]!!.jsonObject
        val dh1 = Primitives.dh(me.signedPrekey.priv, ikA)
        val dh2 = Primitives.dh(me.identity.priv, ekA)
        val dh3 = Primitives.dh(me.signedPrekey.priv, ekA)
        val parts = mutableListOf(dh1, dh2, dh3)
        var usedOtk: JsonObject? = null
        val opk = hs["opk"] as? JsonObject
        if (opk != null) {
            var found = false
            for (otk in me.otks) {
                if (otk.pub.toString() == opk.toString()) {
                    parts.add(Primitives.dh(otk.priv, ekA))
                    usedOtk = otk.priv
                    found = true
                    break
                }
            }
            if (!found) throw IllegalStateException("one-time prekey not found locally")
        }
        val rootKey = Primitives.hkdf(ByteArray(32), parts.reduce { a, b -> a + b }, "fcfc-x3dh", 32)
        return X3dhRespondResult(rootKey, dh3, usedOtk)
    }

    // ── Double Ratchet (ratchet.ts) ───────────────────────────────────────
    class RatchetState(
        var rootKey: String,
        var sendDhPriv: JsonObject?,
        var sendChainKey: String?,
        var sendIdx: Long,
        var prevSendCount: Long,
        var recvKey: JsonObject?,
        var recvChainKey: String?,
        var recvIdx: Long,
        val skipped: MutableMap<String, String>,
    ) {
        fun toJson(peerId: String, established: Boolean, pendingHs: JsonObject?, sendPub: JsonObject?): JsonObject = buildJsonObject {
            put("peerId", peerId)
            put("rootKey", rootKey)
            sendDhPriv?.let { put("sendDhPriv", it) }
            sendChainKey?.let { put("sendChainKey", it) }
            put("sendIdx", sendIdx)
            put("prevSendCount", prevSendCount)
            recvKey?.let { put("recvKey", it) }
            recvChainKey?.let { put("recvChainKey", it) }
            put("recvIdx", recvIdx)
            put("skipped", buildJsonObject { skipped.forEach { (k, v) -> put(k, v) } })
            put("established", established)
            pendingHs?.let { put("_pendingHs", it) }
            sendPub?.let { put("_sendPub", it) }
        }

        companion object {
            fun fromJson(j: JsonObject): RatchetState {
                val sk = j["skipped"]?.jsonObject?.mapValues { (_, v) -> v.jsonPrimitive.content }?.toMutableMap() ?: mutableMapOf()
                return RatchetState(
                    rootKey = j["rootKey"]!!.jsonPrimitive.content,
                    sendDhPriv = j["sendDhPriv"] as? JsonObject,
                    sendChainKey = j["sendChainKey"]?.jsonPrimitive?.contentOrNull,
                    sendIdx = j["sendIdx"]?.jsonPrimitive?.longOrNull ?: 0,
                    prevSendCount = j["prevSendCount"]?.jsonPrimitive?.longOrNull ?: 0,
                    recvKey = j["recvKey"] as? JsonObject,
                    recvChainKey = j["recvChainKey"]?.jsonPrimitive?.contentOrNull,
                    recvIdx = j["recvIdx"]?.jsonPrimitive?.longOrNull ?: 0,
                    skipped = sk,
                )
            }
        }
        var pendingHs: JsonObject? = null
        var sendPub: JsonObject? = null
        var established: Boolean = false
    }

    fun kdfRoot(rootKey: ByteArray, dhOut: ByteArray): Pair<ByteArray, ByteArray> {
        val out = Primitives.hkdf(rootKey, dhOut, "fcfc-rk", 64)
        return out.copyOfRange(0, 32) to out.copyOfRange(32, 64)
    }

    fun kdfChain(chainKey: ByteArray): Pair<ByteArray, ByteArray> =
        Primitives.hmacSha256(chainKey, byteArrayOf(1)) to Primitives.hmacSha256(chainKey, byteArrayOf(2))

    fun pkFingerprint(jwk: JsonObject): String = jwk["x"]?.jsonPrimitive?.content ?: ""
    fun skipKeyRef(jwk: JsonObject, n: Long): String = "${pkFingerprint(jwk)}:$n"

    // ── session store (sessions.ts) ───────────────────────────────────────
    private val peerLocks = HashMap<String, Mutex>()
    private fun peerLock(peerId: String): Mutex = synchronized(peerLocks) {
        peerLocks.getOrPut(peerId) { Mutex() }
    }

    suspend fun <T> withPeerLock(peerId: String, block: suspend () -> T): T = peerLock(peerId).withLock { block() }

    suspend fun getSession(peerId: String): RatchetState? {
        val j = FcDb.get("sessions", peerId)?.jsonObject ?: return null
        val st = RatchetState.fromJson(j)
        st.established = j["established"]?.jsonPrimitive?.booleanOrNull ?: false
        st.pendingHs = j["_pendingHs"] as? JsonObject
        st.sendPub = j["_sendPub"] as? JsonObject
        return st
    }

    var onSessionSaved: (() -> Unit)? = null   // → backup dirty flag
    suspend fun saveSession(peerId: String, st: RatchetState) {
        onSessionSaved?.invoke()
        FcDb.put("sessions", peerId, st.toJson(peerId, st.established, st.pendingHs, st.sendPub))
    }

    suspend fun deleteSession(peerId: String) { FcDb.del("sessions", peerId) }

    /** Fetch prekey bundle via injected getter (avoids net-layer dependency cycle). */
    lateinit var fetchPrekeyBundle: suspend (String) -> JsonObject?

    suspend fun ensureSession(peerId: String): RatchetState {
        getSession(peerId)?.let { if (it.established) return it }
        val me = loadIdentityBundle() ?: throw IllegalStateException("identity not ready")
        val bundle = fetchPrekeyBundle(peerId) ?: throw IllegalStateException("prekey bundle unavailable")
        val x = x3dhInitiate(me, bundle)
        val (rk, chain) = kdfRoot(x.rootKey, x.dh3)
        val st = RatchetState(
            rootKey = Codec.b64u(rk),
            sendDhPriv = x.ekaPriv,
            sendChainKey = Codec.b64u(chain),
            sendIdx = 0,
            prevSendCount = 0,
            recvKey = bundle["spkPub"]?.jsonObject,
            recvChainKey = null,
            recvIdx = 0,
            skipped = mutableMapOf(),
        )
        st.established = true
        st.pendingHs = x.handshake
        st.sendPub = x.ekaPub
        saveSession(peerId, st)
        return st
    }

    /** receiver replying first: establish a fresh send chain (sessions.ts ensureSendChain). */
    private suspend fun ensureSendChain(st: RatchetState) {
        if (st.sendChainKey != null && st.sendDhPriv != null && st.sendPub != null) return
        val recvKey = st.recvKey ?: throw IllegalStateException("cannot establish send chain")
        val pair = Primitives.generateDh()
        val dhOut = Primitives.dh(pair.priv, recvKey)
        val (rk, chain) = kdfRoot(Codec.b64uBytes(st.rootKey), dhOut)
        st.rootKey = Codec.b64u(rk)
        st.sendDhPriv = pair.priv
        st.sendChainKey = Codec.b64u(chain)
        st.sendIdx = 0
        st.prevSendCount = st.recvIdx
        st.sendPub = pair.pub
    }

    class EncParts(val ct: String, val iv: String, val hdr: JsonObject)

    private fun ratchetEncrypt(st: RatchetState, plainJson: String, pubJwk: JsonObject): EncParts {
        val chainKey = Codec.b64uBytes(st.sendChainKey ?: throw IllegalStateException("send chain not initialised"))
        val (mk, next) = kdfChain(chainKey)
        val aead = Primitives.aesGcmEncrypt(mk, Codec.utf8(plainJson))
        val hdr = buildJsonObject {
            put("pk", pubJwk)
            put("pn", st.prevSendCount)
            put("n", st.sendIdx)
        }
        st.sendChainKey = Codec.b64u(next)
        st.sendIdx++
        return EncParts(Codec.b64u(aead.ct), Codec.b64u(aead.iv), hdr)
    }

    /** new send-key material: (priv, pub, dhWithRemote) */
    class NewSendKey(val priv: JsonObject, val pub: JsonObject, val dhWithRemote: suspend (JsonObject) -> ByteArray)

    private suspend fun ratchetDecrypt(
        st: RatchetState, env: JsonObject,
        deriveDh: suspend (JsonObject) -> ByteArray,
        newSendKey: suspend () -> NewSendKey,
    ): JsonElement {
        val hdr = env["hdr"]!!.jsonObject
        val pk = hdr["pk"]!!.jsonObject
        val n = hdr["n"]?.jsonPrimitive?.longOrNull ?: 0
        val pn = hdr["pn"]?.jsonPrimitive?.longOrNull ?: 0
        val ref = skipKeyRef(pk, n)

        // previously skipped key?
        st.skipped[ref]?.let { mkB64 ->
            st.skipped.remove(ref)
            val plain = Primitives.aesGcmDecrypt(
                Codec.b64uBytes(mkB64),
                Codec.b64uBytes(env["ct"]!!.jsonPrimitive.content),
                Codec.b64uBytes(env["iv"]!!.jsonPrimitive.content),
            )
            return JSON.parseToJsonElement(Codec.fromUtf8(plain))
        }

        // new ratchet key → DH step
        if (st.recvKey == null || pkFingerprint(st.recvKey!!) != pkFingerprint(pk)) {
            val oldRecv = st.recvKey
            val oldChain = st.recvChainKey
            if (oldRecv != null && oldChain != null) {
                var chain = Codec.b64uBytes(oldChain)
                var i = st.recvIdx
                while (i < pn && i < st.recvIdx + 1000) {
                    val (mk, next) = kdfChain(chain)
                    st.skipped[skipKeyRef(oldRecv, i)] = Codec.b64u(mk)
                    chain = next
                    i++
                }
                if (st.skipped.size > 800) st.skipped.clear()
            }
            val dhRecv = deriveDh(pk)
            val (rk1, recvChain) = kdfRoot(Codec.b64uBytes(st.rootKey), dhRecv)
            st.recvKey = pk
            st.recvChainKey = Codec.b64u(recvChain)
            st.recvIdx = 0
            st.prevSendCount = st.sendIdx
            val nk = newSendKey()
            st.sendDhPriv = nk.priv
            st.sendPub = nk.pub
            val dhSend = nk.dhWithRemote(pk)
            val (rk2, sendChain) = kdfRoot(rk1, dhSend)
            st.rootKey = Codec.b64u(rk2)
            st.sendChainKey = Codec.b64u(sendChain)
            st.sendIdx = 0
        }

        // advance chain up to hdr.n
        var chain = Codec.b64uBytes(st.recvChainKey ?: throw IllegalStateException("recv chain missing"))
        while (st.recvIdx < n) {
            val (mk, next) = kdfChain(chain)
            st.skipped[skipKeyRef(st.recvKey!!, st.recvIdx)] = Codec.b64u(mk)
            chain = next
            st.recvIdx++
        }
        val (msgKey, nextChain) = kdfChain(chain)
        st.recvChainKey = Codec.b64u(nextChain)
        st.recvIdx++
        val plain = Primitives.aesGcmDecrypt(
            msgKey,
            Codec.b64uBytes(env["ct"]!!.jsonPrimitive.content),
            Codec.b64uBytes(env["iv"]!!.jsonPrimitive.content),
        )
        return JSON.parseToJsonElement(Codec.fromUtf8(plain))
    }

    // ── public encrypt/decrypt (envelope with web field order) ────────────
    suspend fun encryptFor(peerId: String, obj: JsonElement): JsonObject = withPeerLock(peerId) {
        val st = ensureSession(peerId)
        ensureSendChain(st)
        val pub = st.sendPub!!
        val enc = ratchetEncrypt(st, obj.toString(), pub)
        val hs = st.pendingHs
        st.pendingHs = null
        saveSession(peerId, st)
        buildJsonObject {
            put("v", 1)
            put("ct", enc.ct)
            put("iv", enc.iv)
            put("hdr", enc.hdr)
            hs?.let { put("hs", it) }
        }
    }

    suspend fun decryptFrom(peerId: String, env: JsonObject): JsonElement? = withPeerLock(peerId) {
        decryptFromInner(peerId, env, 0)
    }

    private suspend fun decryptFromInner(peerId: String, env: JsonObject, attempt: Int): JsonElement? {
        var st = getSession(peerId)
        val hs = env["hs"] as? JsonObject
        if (st == null && hs != null) {
            // receiver side — build session from handshake
            val me = loadIdentityBundle() ?: throw IllegalStateException("identity not ready")
            val r = x3dhRespond(me, hs)
            val (rk, recvChain) = kdfRoot(r.rootKey, r.dh3Shared)
            st = RatchetState(
                rootKey = Codec.b64u(rk),
                sendDhPriv = null,
                sendChainKey = null,
                sendIdx = 0,
                prevSendCount = 0,
                recvKey = hs["ek"]?.jsonObject,
                recvChainKey = Codec.b64u(recvChain),
                recvIdx = 0,
                skipped = mutableMapOf(),
            )
            st.established = true
            st.sendPub = null
        }
        if (st == null) throw IllegalStateException("no session and no handshake")

        val state = st
        val snapshot: RatchetState? = if (hs != null) deepCopy(st) else null
        val deriveDh: suspend (JsonObject) -> ByteArray = { remotePub ->
            val priv = state.sendDhPriv ?: throw IllegalStateException("send chain not established")
            Primitives.dh(priv, remotePub)
        }
        val newSendKey: suspend () -> NewSendKey = {
            val pair = Primitives.generateDh()
            state.sendPub = pair.pub
            NewSendKey(pair.priv, pair.pub) { r: JsonObject -> Primitives.dh(pair.priv, r) }
        }
        return try {
            val out = ratchetDecrypt(st, env, deriveDh, newSendKey)
            saveSession(peerId, st)
            out
        } catch (e: Exception) {
            if (hs != null && attempt == 0) {
                // handshake not addressed to us (group broadcast) — rebuild, snapshot restore
                deleteSession(peerId)
                try {
                    return decryptFromInner(peerId, env, 1)
                } catch (e2: Exception) {
                    val cur = getSession(peerId)
                    if (cur == null && snapshot != null) saveSession(peerId, snapshot)
                    throw e2
                }
            }
            throw e
        }
    }

    private fun deepCopy(st: RatchetState): RatchetState {
        val c = RatchetState(
            rootKey = st.rootKey, sendDhPriv = st.sendDhPriv, sendChainKey = st.sendChainKey,
            sendIdx = st.sendIdx, prevSendCount = st.prevSendCount, recvKey = st.recvKey,
            recvChainKey = st.recvChainKey, recvIdx = st.recvIdx,
            skipped = st.skipped.toMutableMap(),
        )
        c.established = st.established
        c.pendingHs = st.pendingHs
        c.sendPub = st.sendPub
        return c
    }

    suspend fun hasSession(peerId: String): Boolean =
        getSession(peerId)?.established == true
}
