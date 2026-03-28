package com.cabinskollar.retroboard

import android.content.Context
import android.graphics.*
import android.inputmethodservice.Keyboard
import android.inputmethodservice.KeyboardView
import android.util.AttributeSet
import android.view.Gravity
import android.view.MotionEvent
import android.widget.LinearLayout
import android.widget.PopupWindow
import android.widget.TextView

class RetroKeyboardView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyle: Int = 0
) : KeyboardView(context, attrs, defStyle) {

    private val topPaint  = Paint(Paint.ANTI_ALIAS_FLAG)
    private val edgePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.MONOSPACE
        textAlign = Paint.Align.CENTER
    }
    private val rect  = RectF()
    private val rectE = RectF()

    var skinTokens: SkinTokens? = null
    var shiftActive: Boolean = false
    var isCapsLock: Boolean = false
    var suppressNextKey: Boolean = false
    var onAccentSelected: ((String) -> Unit)? = null

    // Feature 1: feedback tactile visuel
    private val pressedKeys = mutableSetOf<Int>()
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())

    // Feature 4: accents appui long
    private var longPressJob: Runnable? = null
    private val longPressDelay = 400L
    private val accentMap = mapOf(
        'e' to listOf("é", "è", "ê", "ë"),
        'a' to listOf("à", "â", "ä"),
        'u' to listOf("ù", "û", "ü"),
        'i' to listOf("î", "ï"),
        'o' to listOf("ô", "ö"),
        'c' to listOf("ç")
    )

    private var drawErrorShown = false

    fun onKeyPressed(code: Int) {
        pressedKeys.add(code)
        invalidateAllKeys()
        handler.postDelayed({
            pressedKeys.remove(code)
            invalidateAllKeys()
        }, 80)
    }

    private fun getKeyAt(x: Float, y: Float): Keyboard.Key? =
        keyboard?.keys?.firstOrNull { k ->
            x >= k.x && x <= k.x + k.width &&
            y >= k.y && y <= k.y + k.height
        }

    private fun showAccentPopup(key: Keyboard.Key, baseChar: Char) {
        val accents = accentMap[baseChar] ?: return
        val t = skinTokens ?: return

        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(t.keyEdge)
            setPadding(4, 4, 4, 4)
        }

        var popup: PopupWindow? = null
        popup = PopupWindow(
            layout,
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
            android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
            true
        )
        popup.isOutsideTouchable = true

        for (accent in accents) {
            val tv = TextView(context).apply {
                text = accent
                textSize = 24f
                setTextColor(t.keyText)
                setPadding(24, 14, 24, 14)
                setBackgroundColor(t.keyBg)
                setOnClickListener {
                    onAccentSelected?.invoke(accent)
                    popup?.dismiss()
                }
            }
            layout.addView(tv)
            layout.addView(android.view.View(context).apply {
                layoutParams = LinearLayout.LayoutParams(2, LinearLayout.LayoutParams.MATCH_PARENT)
                setBackgroundColor(t.keyEdge)
            })
        }

        try {
            val loc = IntArray(2)
            getLocationOnScreen(loc)
            val xPos = (loc[0] + key.x + key.width / 2 - accents.size * 36).toInt()
            val yPos = (loc[1] + key.y - 160).coerceAtLeast(0)
            popup.showAtLocation(this, Gravity.NO_GRAVITY, xPos, yPos)
        } catch (e: Exception) {
            // Window non attachée, ignore
        }
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                val key = getKeyAt(event.x, event.y)
                val code = key?.codes?.firstOrNull() ?: 0
                if (code in 65..122) {
                    val char = code.toChar().lowercaseChar()
                    if (accentMap.containsKey(char)) {
                        longPressJob = Runnable {
                            suppressNextKey = true
                            showAccentPopup(key!!, char)
                        }
                        handler.postDelayed(longPressJob!!, longPressDelay)
                    }
                }
            }
            MotionEvent.ACTION_MOVE -> {
                longPressJob?.let { handler.removeCallbacks(it) }
                longPressJob = null
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                longPressJob?.let { handler.removeCallbacks(it) }
                longPressJob = null
            }
        }
        return super.onTouchEvent(event)
    }

    override fun onDraw(canvas: Canvas) {
        try {
            val t  = skinTokens ?: run { super.onDraw(canvas); return }
            val kb = keyboard   ?: run { super.onDraw(canvas); return }

            val radius = when (SkinManager.current) {
                Skin.IBM   -> 8f
                Skin.ATARI -> 6f
                Skin.APPLE -> 16f
            }

            canvas.drawColor(t.keyboardBg)

            for (key in kb.keys) {
                val x   = key.x.toFloat()
                val y   = key.y.toFloat()
                val w   = key.width.toFloat()
                val h   = key.height.toFloat()
                val gap = 5f
                val code = key.codes.firstOrNull() ?: 0

                val isPressed    = pressedKeys.contains(code)
                val yOffset      = if (isPressed) 4f else 0f
                val shadowHeight = if (isPressed) 1f else 6f

                val (bgTop, bgBot, edge) = when (code) {
                    -100 -> Triple(lighten(t.copyBg,  0.25f), t.copyBg,  darken(t.copyBg,  0.4f))
                    -102 -> Triple(lighten(t.pasteBg, 0.25f), t.pasteBg, darken(t.pasteBg, 0.4f))
                    -200 -> when {
                        isCapsLock  -> Triple(lighten(t.accent,  0.2f), t.accent,  darken(t.accent,  0.3f))
                        shiftActive -> Triple(lighten(t.accent2, 0.2f), t.accent2, darken(t.accent2, 0.3f))
                        else        -> Triple(lighten(t.actionBg, 0.1f), t.actionBg, darken(t.actionBg, 0.3f))
                    }
                    -1, 10, -5, -101, -103 ->
                        Triple(lighten(t.actionBg, 0.2f), t.actionBg, darken(t.actionBg, 0.4f))
                    else -> Triple(lighten(t.keyBg, 0.25f), t.keyBg, t.keyEdge)
                }

                val bgTopFinal = if (isPressed) darken(bgTop, 0.12f) else bgTop
                val bgBotFinal = if (isPressed) darken(bgBot, 0.12f) else bgBot

                // Ombre basse
                edgePaint.color = edge
                rectE.set(x + gap, y + gap + 4f + yOffset, x + w - gap, y + h - gap + shadowHeight + yOffset)
                canvas.drawRoundRect(rectE, radius, radius, edgePaint)

                // Corps touche avec gradient
                val shader = LinearGradient(
                    x, y + gap + yOffset,
                    x, y + h - gap + yOffset,
                    bgTopFinal, bgBotFinal,
                    Shader.TileMode.CLAMP
                )
                topPaint.shader = shader
                rect.set(x + gap, y + gap + yOffset, x + w - gap, y + h - gap - 3f + yOffset)
                canvas.drawRoundRect(rect, radius, radius, topPaint)

                // Label
                val label = key.label?.toString() ?: continue
                if (label.isEmpty()) continue
                val displayLabel = if (shiftActive && label.length == 1 && label[0].isLetter()) {
                    label.uppercase()
                } else label

                textPaint.color = when (code) {
                    -100              -> t.copyText
                    -102              -> t.pasteText
                    in 48..57         -> t.numText
                    -1, -200, 10, -5,
                    -101, -103        -> t.actionText
                    else              -> t.keyText
                }

                textPaint.textSize = when {
                    displayLabel.length > 4 -> 22f
                    displayLabel.length > 2 -> 26f
                    displayLabel.length > 1 -> 30f
                    else                    -> 36f
                }

                val tx = x + w / 2f
                val ty = y + h / 2f - (textPaint.descent() + textPaint.ascent()) / 2f + yOffset
                canvas.drawText(displayLabel, tx, ty, textPaint)
            }
        } catch (e: Exception) {
            if (!drawErrorShown) {
                drawErrorShown = true
                android.widget.Toast.makeText(
                    context,
                    "DBG onDraw crash: ${e.javaClass.simpleName}: ${e.message}",
                    android.widget.Toast.LENGTH_LONG
                ).show()
            }
            super.onDraw(canvas)
        }
    }

    private fun lighten(color: Int, factor: Float): Int {
        val r = ((Color.red(color)   + (255 - Color.red(color))   * factor).toInt()).coerceIn(0, 255)
        val g = ((Color.green(color) + (255 - Color.green(color)) * factor).toInt()).coerceIn(0, 255)
        val b = ((Color.blue(color)  + (255 - Color.blue(color))  * factor).toInt()).coerceIn(0, 255)
        return Color.rgb(r, g, b)
    }

    private fun darken(color: Int, factor: Float): Int {
        val r = (Color.red(color)   * (1f - factor)).toInt().coerceIn(0, 255)
        val g = (Color.green(color) * (1f - factor)).toInt().coerceIn(0, 255)
        val b = (Color.blue(color)  * (1f - factor)).toInt().coerceIn(0, 255)
        return Color.rgb(r, g, b)
    }
}
