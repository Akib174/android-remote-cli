package com.fcfc.app.crypto

import com.fcfc.app.core.Codec
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.bouncycastle.crypto.agreement.ECDHBasicAgreement
import org.bouncycastle.crypto.agreement.X25519Agreement
import org.bouncycastle.crypto.generators.ECKeyPairGenerator
import org.bouncycastle.crypto.params.ECDomainParameters
import org.bouncycastle.crypto.params.ECKeyGenerationParameters
import org.bouncycastle.crypto.params.ECPrivateKeyParameters
import org.bouncycastle.crypto.params.ECPublicKeyParameters
import org.bouncycastle.crypto.params.X25519PrivateKeyParameters
import org.bouncycastle.crypto.params.X25519PublicKeyParameters
import org.bouncycastle.crypto.signers.ECDSASigner
import org.bouncycastle.jce.ECNamedCurveTable
import org.bouncycastle.math.ec.ECPoint
import java.math.BigInteger
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Crypto primitives — byte-exact ports of the WebCrypto operations the web
 * client performs. Curve policy mirrors frontend/src/crypto/keys.ts:
 * X25519 for key agreement (modern Chromium path), P-256 supported on
 * import for interop with fallback browsers, P-256 + SHA-256 ECDSA with
 * RAW P-1363 r||s (64 bytes) for signed-prekey signatures.
 *
 * JWK canonical field order (Chrome export order, alphabetical):
 *   pub  : crv, ext, key_ops, kty, x [, y]
 *   priv : crv, d, ext, key_ops, kty, x [, y]
 */
object Primitives {
    private val random = SecureRandom()
    private val P256: ECDomainParameters = run {
        val spec = ECNamedCurveTable.getParameterSpec("P-256")
        ECDomainParameters(spec.curve, spec.g, spec.n, spec.h)
    }

    const val CRV_X25519 = "X25519"
    const val CRV_P256 = "P-256"

    // ── random ──
    fun randomBytes(n: Int): ByteArray = ByteArray(n).also { random.nextBytes(it) }

    // ── HMAC-SHA256 ──
    fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    // ── HKDF-SHA256 (RFC 5869; matches WebCrypto deriveBits semantics) ──
    fun hkdf(salt: ByteArray, ikm: ByteArray, info: String, len: Int): ByteArray {
        val prk = hmacSha256(salt, ikm)
        val infoBytes = info.toByteArray(Charsets.UTF_8)
        val out = ByteArray(len)
        var t = ByteArray(0)
        var pos = 0
        var counter = 1
        while (pos < len) {
            val input = t + infoBytes + byteArrayOf(counter.toByte())
            t = hmacSha256(prk, input)
            val n = minOf(t.size, len - pos)
            System.arraycopy(t, 0, out, pos, n)
            pos += n
            counter++
        }
        return out
    }

    // ── AES-GCM (128-bit tag, 12-byte IV, no AAD) ──
    class AeadResult(val ct: ByteArray, val iv: ByteArray)

    fun aesGcmEncrypt(key: ByteArray, plain: ByteArray, iv: ByteArray = randomBytes(12)): AeadResult {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        return AeadResult(c.doFinal(plain), iv)
    }

    fun aesGcmDecrypt(key: ByteArray, ct: ByteArray, iv: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        return c.doFinal(ct)
    }

    // ── PBKDF2-HMAC-SHA256 (RFC 2898) ──
    // Built directly on javax.crypto.Mac with the password passed as EXPLICIT
    // UTF-8 bytes — byte-identical to the web's TextEncoder input for every
    // password, ASCII and non-ASCII alike.
    //
    // The previous SecretKeyFactory/PBEKeySpec route delegated the char[]→byte
    // conversion to the platform's PBKDF2 engine. That conversion is UTF-8 on
    // stock Android/JDK but is NOT contractual ("and8bit" variants exist), so
    // an exotic ROM could silently derive different bytes for non-ASCII
    // passwords → server sees a wrong client hash → misleading "invalid
    // credentials". Doing the conversion ourselves removes that variable
    // entirely. The algorithm and output are unchanged — verified byte-for-
    // byte against the real web implementation (AuthContractTest vectors).
    fun pbkdf2(secret: String, salt: ByteArray, iterations: Int = 600_000, bits: Int = 256): ByteArray {
        require(iterations >= 1) { "iterations must be >= 1" }
        require(bits > 0 && bits % 8 == 0) { "bits must be a positive multiple of 8" }
        val pw = Codec.utf8(secret)
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(pw, "HmacSHA256"))
        val hLen = 32
        val dkLen = bits / 8
        val out = ByteArray(dkLen)
        var block = 0
        var off = 0
        while (off < dkLen) {
            block++
            // U1 = HMAC(P, S || INT32BE(block))  — RFC 2898 §5.2: salt FIRST
            mac.update(salt)
            mac.update(byteArrayOf(
                (block ushr 24).toByte(), (block ushr 16).toByte(),
                (block ushr 8).toByte(), block.toByte(),
            ))
            var u = mac.doFinal()
            val t = u.copyOf()
            repeat(iterations - 1) {
                u = mac.doFinal(u)
                for (i in t.indices) t[i] = (t[i].toInt() xor u[i].toInt()).toByte()
            }
            val n = minOf(hLen, dkLen - off)
            System.arraycopy(t, 0, out, off, n)
            off += n
        }
        return out
    }

    // ── crypto known-answer self-test (2 vectors, 1 iteration each) ──
    // Expected values generated with the reference implementation the web
    // uses (WebCrypto PBKDF2). Runs in microseconds; called before every
    // login/signup/passcode derivation so a broken or 8-bit-truncating
    // HmacSHA256/PBKDF2 on an exotic ROM surfaces as a CLEAR device error
    // instead of a misleading server "invalid credentials". Vector 2 uses a
    // non-ASCII secret — chars above U+00FF are where truncating encoders
    // diverge from UTF-8.
    private const val KAT_ASCII = "MGS2jLNR-od1rCODhAtOsOS4-JLM00EfYuXg_FiwiVs"
    private const val KAT_UTF8 = "kgq9zND1rJ7fcwhZ94QQqsy9YN10wuuLcLKZ-_5G3-Q"

    fun cryptoSelfTest() {
        val salt = Codec.utf8("fcfc-kat")
        val h1 = Codec.b64u(pbkdf2("kat", salt, 1, 256))
        val h2 = Codec.b64u(pbkdf2("মাল", salt, 1, 256))
        if (h1 != KAT_ASCII || h2 != KAT_UTF8)
            throw IllegalStateException("device crypto self-test failed (PBKDF2/HMAC-SHA256 known-answer mismatch)")
    }

    // ══════════════════════════════════════════════════════════════════════
    // Key pairs — stored as JWK JsonObjects (canonical order, alphabetical)
    // ══════════════════════════════════════════════════════════════════════
    class KeyPair(val pub: JsonObject, val priv: JsonObject) {
        /** raw wire form for DH math */
        val crv: String = pub["crv"]?.jsonPrimitive?.content ?: CRV_X25519
    }

    /** Generate a DH key pair — X25519 (modern-Chromium path). */
    fun generateDh(): KeyPair {
        val priv = X25519PrivateKeyParameters(random)
        val pub = priv.generatePublicKey()
        val x = Codec.b64u(pub.encoded)
        val d = Codec.b64u(priv.encoded)
        return KeyPair(
            pub = buildJsonObject {
                put("crv", CRV_X25519); put("ext", true)
                put("key_ops", kotlinx.serialization.json.JsonArray(emptyList()))
                put("kty", "OKP"); put("x", x)
            },
            priv = buildJsonObject {
                put("crv", CRV_X25519); put("d", d); put("ext", true)
                put("key_ops", kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive("deriveBits"))))
                put("kty", "OKP"); put("x", x)
            },
        )
    }

    /** Generate an ECDSA P-256 signing key pair. */
    fun generateSign(): KeyPair {
        val gen = ECKeyPairGenerator()
        gen.init(ECKeyGenerationParameters(P256, random))
        val kp = gen.generateKeyPair()
        val pub = kp.public as ECPublicKeyParameters
        val priv = kp.private as ECPrivateKeyParameters
        val x = Codec.b64u(fixed32(pub.q.affineXCoord.toBigInteger()))
        val y = Codec.b64u(fixed32(pub.q.affineYCoord.toBigInteger()))
        val d = Codec.b64u(fixed32(priv.d))
        return KeyPair(
            pub = buildJsonObject {
                put("crv", CRV_P256); put("ext", true)
                put("key_ops", kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive("verify"))))
                put("kty", "EC"); put("x", x); put("y", y)
            },
            priv = buildJsonObject {
                put("crv", CRV_P256); put("d", d); put("ext", true)
                put("key_ops", kotlinx.serialization.json.JsonArray(listOf(kotlinx.serialization.json.JsonPrimitive("sign"))))
                put("kty", "EC"); put("x", x); put("y", y)
            },
        )
    }

    private fun fixed32(v: BigInteger): ByteArray {
        val raw = v.toByteArray()   // may include sign byte / strip leading zeros
        return when {
            raw.size == 32 -> raw
            raw.size == 33 -> raw.copyOfRange(1, 33)
            raw.size < 32 -> ByteArray(32) + raw.copyOfRange(0, 0).let { raw } // pad left
            else -> raw.copyOfRange(raw.size - 32, raw.size)
        }.let {
            if (it.size < 32) ByteArray(32 - it.size) + it else it
        }
    }

    // ── ECDH — 32-byte shared secret ──
    /** dh(privJwk, pubJwk) — both JWKs must share the same crv. */
    fun dh(privJwk: JsonObject, pubJwk: JsonObject): ByteArray {
        val crv = pubJwk["crv"]?.jsonPrimitive?.content ?: privJwk["crv"]?.jsonPrimitive?.content ?: CRV_X25519
        return when (crv) {
            CRV_X25519 -> {
                val priv = X25519PrivateKeyParameters(Codec.b64uBytes(privJwk["d"]!!.jsonPrimitive.content), 0)
                val pub = X25519PublicKeyParameters(Codec.b64uBytes(pubJwk["x"]!!.jsonPrimitive.content), 0)
                val agr = X25519Agreement()
                agr.init(priv)
                ByteArray(agr.agreementSize).also { agr.calculateAgreement(pub, it, 0) }
            }
            CRV_P256 -> {
                val d = BigInteger(1, Codec.b64uBytes(privJwk["d"]!!.jsonPrimitive.content))
                val x = BigInteger(1, Codec.b64uBytes(pubJwk["x"]!!.jsonPrimitive.content))
                val y = BigInteger(1, Codec.b64uBytes(pubJwk["y"]!!.jsonPrimitive.content))
                val priv = ECPrivateKeyParameters(d, P256)
                val q: ECPoint = P256.curve.createPoint(x, y)
                val pub = ECPublicKeyParameters(q, P256)
                val agr = ECDHBasicAgreement()
                agr.init(priv)
                fixed32(agr.calculateAgreement(pub))
            }
            else -> throw IllegalArgumentException("unsupported crv: $crv")
        }
    }

    // ── ECDSA P-256 + SHA-256, RAW P-1363 r||s (64 bytes) ──
    fun ecdsaSign(privJwk: JsonObject, message: ByteArray): ByteArray {
        val d = BigInteger(1, Codec.b64uBytes(privJwk["d"]!!.jsonPrimitive.content))
        val signer = ECDSASigner()   // signs the digest we pass in
        signer.init(true, org.bouncycastle.crypto.params.ParametersWithRandom(ECPrivateKeyParameters(d, P256), random))
        val rs = signer.generateSignature(Codec.sha256(message))
        return fixed32(rs[0]) + fixed32(rs[1])
    }

    fun ecdsaVerify(pubJwk: JsonObject, message: ByteArray, sig: ByteArray): Boolean = try {
        require(sig.size == 64) { "raw signature must be 64 bytes" }
        val x = BigInteger(1, Codec.b64uBytes(pubJwk["x"]!!.jsonPrimitive.content))
        val y = BigInteger(1, Codec.b64uBytes(pubJwk["y"]!!.jsonPrimitive.content))
        val pub = ECPublicKeyParameters(P256.curve.createPoint(x, y), P256)
        val signer = ECDSASigner()
        signer.init(false, pub)
        val r = BigInteger(1, sig.copyOfRange(0, 32))
        val s = BigInteger(1, sig.copyOfRange(32, 64))
        signer.verifySignature(Codec.sha256(message), r, s)
    } catch (_: Exception) { false }

    // ── JWK canonical stringify (alphabetical order preserved by JsonObject) ──
    fun jwkStringify(jwk: JsonObject): String = jwk.toString()

    fun jwkHasFields(jwk: JsonObject, priv: Boolean): Boolean {
        if (jwk["crv"]?.jsonPrimitive?.contentOrNull == null) return false
        if (jwk["x"]?.jsonPrimitive?.contentOrNull == null) return false
        if (priv && jwk["d"]?.jsonPrimitive?.contentOrNull == null) return false
        return true
    }
}
