package com.fcfc.app.net

import kotlinx.coroutines.flow.MutableStateFlow

/**
 * Server URL configuration — port of the web app's build-time VITE_API_BASE.
 *
 * The deployed Worker is the single fixed backend for this build:
 *   https://fcfc-backend.nakibpro1.workers.dev
 *
 * Every Android network hop goes through the Worker:
 *   - REST   → https://fcfc-backend.nakibpro1.workers.dev/api/...
 *   - WS     → wss://fcfc-backend.nakibpro1.workers.dev/ws (chat + hub sockets)
 *   - Calls  → the same origin under /calls/* — the Worker holds the
 *              Cloudflare Calls app credentials (CALLS_APP_ID / CALLS_API_TOKEN
 *              / App Secret) server-side and proxies SDP/tracks negotiation.
 *
 * There is deliberately NO user-facing server URL entry, no server picker and
 * no credentials input on Android: the web app never had one, and the
 * architecture requires all traffic to be proxied by this Worker.
 * Normalization mirrors the web client (trailing slashes stripped).
 */
object ServerConfig {
    /** Canonical deployed Worker base URL (https, no trailing slash). */
    const val WORKER_BASE = "https://fcfc-backend.nakibpro1.workers.dev"

    /** Observable base URL — fixed for the lifetime of the process. */
    val baseUrl = MutableStateFlow(WORKER_BASE)

    /** No-op initializer kept for call-site symmetry; the base is constant. */
    fun init() {
        baseUrl.value = WORKER_BASE
    }

    fun normalize(url: String): String = url.trim().replace(Regex("/+$"), "")

    /** WebSocket endpoint derived from the same fixed origin. */
    fun wsUrl(): String = baseUrl.value.replaceFirst(Regex("^http"), "ws")
}
