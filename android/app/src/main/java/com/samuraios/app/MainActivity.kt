package com.samuraios.app

import android.Manifest
import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

class MainActivity : ComponentActivity() {

    private val permissionsLauncher =
        registerForActivityResult(
            ActivityResultContracts.RequestMultiplePermissions()
        ) {
            showStatus()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val text = TextView(this).apply {
            text = "SAMURAIOS\n\nCAMERA + GPS + PRIVATE VAULT"
            textSize = 20f
            setPadding(40, 80, 40, 40)
        }

        setContentView(text)

        permissionsLauncher.launch(
            arrayOf(
                Manifest.permission.CAMERA,
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            )
        )
    }

    private fun showStatus() {
        val files = Vault.listPhotos(this)

        val view = findViewById<TextView>(
            android.R.id.content
        )

        view?.contentDescription =
            "Private photos: ${files.size}"
    }
}
