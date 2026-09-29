package com.fcfc.app.core

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull

/**
 * i18n — loads the extracted web dictionary (assets/i18n.json, 364 keys × en/bn).
 * t(key) interpolation: {name} style.
 */
object I18n {
    private lateinit var dict: JsonObject
    private lateinit var dictBn: JsonObject
    val lang = MutableStateFlow("en")

    private val json = Json { ignoreUnknownKeys = true }

    fun init(ctx: Context) {
        val text = ctx.assets.open("i18n.json").bufferedReader().use { it.readText() }
        val root = json.parseToJsonElement(text).jsonObject
        dict = root["en"]!!.jsonObject
        dictBn = root["bn"]!!.jsonObject
        val saved = ctx.getSharedPreferences("fcfc.ui", Context.MODE_PRIVATE).getString("lang", null)
        if (saved == "en" || saved == "bn") lang.value = saved
    }

    fun setLang(l: String, ctx: Context) {
        lang.value = if (l == "bn") "bn" else "en"
        ctx.getSharedPreferences("fcfc.ui", Context.MODE_PRIVATE).edit().putString("lang", l).apply()
    }

    fun t(key: String, vars: Map<String, String> = emptyMap()): String {
        val table = if (lang.value == "bn") dictBn else dict
        var s = table[key]?.jsonPrimitive?.contentOrNull ?: (dict[key]?.jsonPrimitive?.contentOrNull ?: key)
        for ((k, v) in vars) s = s.replace("{$k}", v)
        return s
    }
}

/** Convenience: t("key") from anywhere. */
fun t(key: String, vararg vars: Pair<String, String>): String = I18n.t(key, vars.toMap())
