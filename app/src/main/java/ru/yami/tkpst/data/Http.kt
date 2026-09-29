package ru.yami.tkpst.data

import java.net.HttpURLConnection
import java.net.URL

class ApiException(message: String) : Exception(message)

/** Простой GET без сторонних библиотек. */
object Http {
    const val USER_AGENT = "TkpstSchedule/1.0 (Android; github.com/WTFHOSHI/tkpst-schedule)"

    fun get(url: String, timeoutMs: Int = 15_000, connectMs: Int = 10_000): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = connectMs
        conn.readTimeout = timeoutMs
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("User-Agent", USER_AGENT)
        conn.setRequestProperty("Accept-Language", "ru")
        try {
            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val body = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw ApiException("Сервер ответил $code")
            return body
        } finally {
            conn.disconnect()
        }
    }
}
