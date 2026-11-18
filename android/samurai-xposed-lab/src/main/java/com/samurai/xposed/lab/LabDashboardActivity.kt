package com.samurai.xposed.lab

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.LinearLayout
import android.widget.TextView

class LabDashboardActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(28, 32, 28, 32)
            setBackgroundColor(0xFF0B1118.toInt())
        }

        root.addView(TextView(this).apply {
            text = "SAMURAI XPOSED LAB"
            textSize = 22f
            setTextColor(0xFF00D98B.toInt())
            gravity = Gravity.CENTER
        })

        root.addView(TextView(this).apply {
            text = "Изолированная среда проверки совместимости WhatsApp.\n\n" +
                "Текущая сборка только определяет пакет и версию клиента через LSPosed. " +
                "Перехват сообщений, квитанций, присутствия и медиа отключён.\n\n" +
                "Для активации диагностики требуется root и совместимый LSPosed. " +
                "Не устанавливайте этот лабораторный модуль на основной WhatsApp до проверки на отдельном устройстве и аккаунте."
            textSize = 15f
            setTextColor(0xFFE5EDF5.toInt())
            gravity = Gravity.CENTER
            setPadding(0, 24, 0, 0)
        })

        setContentView(root)
    }
}
