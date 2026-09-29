package com.fcfc.app.crypto

import kotlinx.serialization.json.JsonObject

/**
 * Crypto facade — the public surface of the ported frontend/src/crypto modules.
 * Implemented by the crypto agent; consumed by stores/media.
 *
 * INTEROP CONTRACT (byte-exact with the web client — verified against
 * /home/z/my-project/analysis/crypto-vectors/vectors.json):
 *  - ECDH: P-256 (X25519 path is dead code in Chromium; production is P-256)
 *  - ECDSA: P-256 + SHA-256, RAW P-1363 r||s (64 bytes), NOT DER
 *  - JWK serialization property order:
 *      pub:  crv, ext, key_ops, kty, x, y
 *      priv: crv, d, ext, key_ops, kty, x, y
 *    key_ops: ECDH pub [] / ECDH priv ["deriveBits"] / ECDSA pub ["verify"] / priv ["sign"]
 *    spkSig = ECDSA over JSON.stringify(spkPubJwk) in EXACTLY that order
 *  - X3DH: dh1=IKa×SPKb, dh2=EKa×IKb, dh3=EKa×SPKb (+dh4=EKa×OPKb);
 *    RK0 = HKDF-SHA256(salt=32 zero bytes, info="fcfc-x3dh", ikm=dh1||dh2||dh3[||dh4], L=32)
 *  - Ratchet: KDF_RK=HKDF(salt=rootKey, ikm=dhOut, info="fcfc-rk", 64) split 32/32;
 *    KDF_CK=HMAC-SHA256(chainKey, 0x01=msgKey | 0x02=nextChain)
 *  - AEAD: AES-GCM-256, random 12-byte IV, no AAD
 *  - Envelope 1:1 (field order matters): {v, ct, iv, hdr:{pk, pn, n}, hs?} — hs appended last, first msg only
 *  - Envelope group: {v, g:1, sid, n, ct, iv}
 *  - Files: 1MiB chunks, AES-GCM, nonce = baseIV with BE uint32 at [8..12) += chunkIndex
 *  - Backup: PBKDF2-SHA256 600k, salt random 16B, AES-GCM blob = b64u(iv(12)||ct);
 *    pin secret string = "fcfc-pin:<pin>"
 */
interface CryptoFacade {

    // ── JWK ──
    fun jwkStringify(jwk: JsonObject): String   // exact web order
    fun jwkParse(s: String): JsonObject

    // ── identity bundle ──
    fun createIdentityBundle(): IdentityMaterial
    fun persistBundle(m: IdentityMaterial)
    fun loadIdentityBundle(): IdentityMaterial?
    fun publicBundleForUpload(m: IdentityMaterial): JsonObject

    // ── X3DH ──
    /** Alice side: init session with Bob's bundle → (rootKey, ephemeral material, handshake) */
    fun x3dhInit(theirBundle: JsonObject): X3dhInitResult
    /** Bob side: respond to first-message handshake → rootKey + (matched OTK priv if any) */
    fun x3dhRespond(handshake: JsonObject, myBundle: IdentityMaterial): X3dhRespondResult
    fun verifySignedPrekey(spkPub: JsonObject, sig: String, signPub: JsonObject): Boolean

    // ── Double Ratchet sessions (1:1) ──
    suspend fun encryptDm(peerId: String, chatId: String, plaintext: ByteArray): EnvelopeJson
    suspend fun decryptDm(peerId: String, chatId: String, env: EnvelopeJson): ByteArray
    suspend fun encryptSelf(chatId: String, plaintext: ByteArray): EnvelopeJson
    suspend fun decryptSelf(env: EnvelopeJson): ByteArray
    fun hasSessionWith(peerId: String): Boolean
    suspend fun renegotiate(peerId: String, chatId: String): X3dhInitResult

    // ── Sender keys (groups) ──
    suspend fun senderKeyEnsure(chatId: String): SenderKeyState
    suspend fun senderKeyMessages(chatId: String, members: List<String>): List<Pair<String, EnvelopeJson>>
    suspend fun encryptGroup(chatId: String, plaintext: ByteArray): EnvelopeJson
    suspend fun decryptGroup(env: EnvelopeJson, chatId: String): ByteArray
    suspend fun handleSenderKeyMessage(env: EnvelopeJson, senderId: String)

    // ── files ──
    fun encryptFile(bytes: ByteArray): EncryptedFile
    fun decryptFile(bytes: ByteArray, keyB64u: String, ivB64u: String): ByteArray

    // ── backup ──
    suspend fun createBackupBlob(secret: String, dump: ByteArray): BackupBlob
    suspend fun decryptBackupBlob(secret: String, blob: BackupBlob): ByteArray
    suspend fun buildDump(messages: Map<String, List<com.fcfc.app.model.Message>>): ByteArray
    suspend fun restoreDump(dump: ByteArray): RestoredDump
    suspend fun markBackupDirty()

    // ── passcode / password hashing (client-side, PBKDF2 600k) ──
    fun clientPassHash(password: String, saltDomain: String): String
}

// ── value types ──
data class JwkPair(val pub: JsonObject, val priv: JsonObject)

data class IdentityMaterial(
    val identity: JwkPair,
    val signing: JwkPair,
    val signedPrekey: JwkPair,
    val spkSig: String,
    val otks: List<JwkPair>,
)

data class X3dhInitResult(
    val rootKey: ByteArray,
    val ephemeralPriv: JsonObject,
    val handshake: JsonObject,      // {ik, ek, opk}
)

data class X3dhRespondResult(
    val rootKey: ByteArray,
    val usedOtkIndex: Int?,          // index into otks that matched (null = no OTK)
)

/** Envelope as kotlinx JsonObject with EXACT field order (v, ct, iv, hdr, hs / v, g, sid, n, ct, iv). */
typealias EnvelopeJson = JsonObject

data class SenderKeyState(val chainKeyB64u: String, val idx: Long, val sid: String)

data class EncryptedFile(
    val bytes: ByteArray,
    val keyB64u: String,
    val ivB64u: String,
    val size: Long,
)

data class BackupBlob(val blob: String, val salt: String)

data class RestoredDump(
    val keys: IdentityMaterial?,
    val sessions: Map<String, JsonObject>,
    val senderKeys: Map<String, JsonObject>,
    val messages: Map<String, List<com.fcfc.app.model.Message>>,
    val starred: Set<String>,
    val meta: Map<String, String>,
)
