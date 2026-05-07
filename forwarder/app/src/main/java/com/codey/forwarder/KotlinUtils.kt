package com.codey.app

internal fun String?.trimOrEmpty(): String = this?.trim().orEmpty()

internal fun String?.takeAtMost(length: Int): String {
    if (this == null) {
        return ""
    }
    return if (this.length <= length) this else substring(0, length)
}

internal fun Throwable.safeMessage(): String = message ?: javaClass.simpleName
