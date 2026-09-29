package com.fcfc.app.net

/**
 * REST API surface — implemented by [ApiClient] (OkHttp).
 * Endpoint shapes verified against worker route files the previous
 * speculative interface was replaced by the concrete ApiClient object
 * whose signatures mirror the server's actual responses.
 */
class ApiException(val code: Int, message: String) : Exception(message)
