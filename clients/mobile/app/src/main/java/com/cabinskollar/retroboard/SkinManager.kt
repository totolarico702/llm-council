package com.cabinskollar.retroboard

import android.graphics.Color

enum class Skin { IBM, ATARI, APPLE }

data class SkinTokens(
    val keyboardBg:  Int,
    val keyBg:       Int,
    val keyEdge:     Int,
    val keyText:     Int,
    val numText:     Int,
    val arrowRowBg:  Int,
    val arrowBg:     Int,
    val arrowText:   Int,
    val actionBg:    Int,
    val actionText:  Int,
    val copyBg:      Int,
    val copyText:    Int,
    val pasteBg:     Int,
    val pasteText:   Int,
    val accent:      Int,
    val accent2:     Int,
)

object SkinManager {

    var current: Skin = Skin.IBM
        private set

    fun next(): Skin {
        current = when (current) {
            Skin.IBM   -> Skin.ATARI
            Skin.ATARI -> Skin.APPLE
            Skin.APPLE -> Skin.IBM
        }
        return current
    }

    fun tokens(): SkinTokens = when (current) {

        Skin.IBM -> SkinTokens(
            keyboardBg  = Color.parseColor("#2a2a2a"),
            keyBg       = Color.parseColor("#3c3c3c"),
            keyEdge     = Color.parseColor("#222222"),
            keyText     = Color.parseColor("#d4d0c8"),
            numText     = Color.parseColor("#c8b870"),
            arrowRowBg  = Color.parseColor("#1e2430"),
            arrowBg     = Color.parseColor("#222838"),
            arrowText   = Color.parseColor("#7090b8"),
            actionBg    = Color.parseColor("#303030"),
            actionText  = Color.parseColor("#a8a49c"),
            copyBg      = Color.parseColor("#252e20"),
            copyText    = Color.parseColor("#70a060"),
            pasteBg     = Color.parseColor("#2e2020"),
            pasteText   = Color.parseColor("#c07878"),
            accent      = Color.parseColor("#c8b870"),
            accent2     = Color.parseColor("#7090b8"),
        )

        Skin.ATARI -> SkinTokens(
            keyboardBg  = Color.parseColor("#b8a898"),
            keyBg       = Color.parseColor("#d4c8b8"),
            keyEdge     = Color.parseColor("#8a7060"),
            keyText     = Color.parseColor("#2a1808"),
            numText     = Color.parseColor("#8a3020"),
            arrowRowBg  = Color.parseColor("#7a5840"),
            arrowBg     = Color.parseColor("#9a6850"),
            arrowText   = Color.parseColor("#f0e0c8"),
            actionBg    = Color.parseColor("#9a5840"),
            actionText  = Color.parseColor("#f8f0e0"),
            copyBg      = Color.parseColor("#a06040"),
            copyText    = Color.parseColor("#f8f0e0"),
            pasteBg     = Color.parseColor("#904830"),
            pasteText   = Color.parseColor("#f8f0e0"),
            accent      = Color.parseColor("#e04810"),
            accent2     = Color.parseColor("#c85808"),
        )

        Skin.APPLE -> SkinTokens(
            keyboardBg  = Color.parseColor("#ccc8bc"),
            keyBg       = Color.parseColor("#dcd8cc"),
            keyEdge     = Color.parseColor("#998878"),
            keyText     = Color.parseColor("#181408"),
            numText     = Color.parseColor("#882838"),
            arrowRowBg  = Color.parseColor("#98a8b8"),
            arrowBg     = Color.parseColor("#a8b8c8"),
            arrowText   = Color.parseColor("#182840"),
            actionBg    = Color.parseColor("#b0aca0"),
            actionText  = Color.parseColor("#282018"),
            copyBg      = Color.parseColor("#a8c0a0"),
            copyText    = Color.parseColor("#183010"),
            pasteBg     = Color.parseColor("#c0a8a0"),
            pasteText   = Color.parseColor("#381018"),
            accent      = Color.parseColor("#882838"),
            accent2     = Color.parseColor("#3a5878"),
        )
    }
}
