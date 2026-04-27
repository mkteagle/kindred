package com.kindlingsignal.kindred.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Cloud
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * First-run screen where users enter their backend server URL.
 * Validates the URL with a health check before proceeding.
 */
@Composable
fun ServerSetupScreen(
    viewModel: AuthViewModel,
    onSetupComplete: () -> Unit,
    onSkipToDemo: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current

    var serverUrl by remember { mutableStateOf("") }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(80.dp))

        // App icon
        Box(
            modifier = Modifier
                .size(80.dp)
                .shadow(18.dp, RoundedCornerShape(20.dp), ambientColor = KindredColors.CardShadow, spotColor = KindredColors.CardShadow)
                .clip(RoundedCornerShape(20.dp))
                .background(KindredColors.Ember),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "K",
                style = KindredType.display(42),
                color = KindredColors.Card,
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = "Connect your server.",
            style = KindredType.display(26, FontWeight.Bold),
            color = KindredColors.Ash,
        )

        Text(
            text = "Enter the URL of your Kindred backend\nto get started.",
            style = KindredType.Body,
            color = KindredColors.Pine,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )

        Spacer(modifier = Modifier.height(32.dp))

        // Server URL input
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = "SERVER URL",
                style = KindredType.Micro,
                color = KindredColors.Mist,
            )

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(KindredShape.RadiusSM)
                    .background(KindredColors.Card)
                    .border(1.dp, KindredColors.Line, KindredShape.RadiusSM)
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Icon(
                    imageVector = Icons.Outlined.Cloud,
                    contentDescription = null,
                    tint = KindredColors.Mist,
                    modifier = Modifier.size(18.dp),
                )

                Box(modifier = Modifier.weight(1f)) {
                    if (serverUrl.isEmpty()) {
                        Text(
                            text = "https://your-server.example.com",
                            style = KindredType.Body,
                            color = KindredColors.Mist,
                        )
                    }
                    androidx.compose.foundation.text.BasicTextField(
                        value = serverUrl,
                        onValueChange = { serverUrl = it },
                        textStyle = KindredType.Body.copy(color = KindredColors.Ash),
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(
                            keyboardType = KeyboardType.Uri,
                            imeAction = ImeAction.Done,
                        ),
                        keyboardActions = KeyboardActions(
                            onDone = { focusManager.clearFocus() },
                        ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }

        // Connect button
        val canConnect = serverUrl.isNotBlank() && !uiState.isLoggingIn

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 16.dp)
                .clip(KindredShape.RadiusSM)
                .background(if (canConnect) KindredColors.Ember else KindredColors.Ember.copy(alpha = 0.5f))
                .clickable(enabled = canConnect) {
                    val url = if (!serverUrl.startsWith("http")) "https://$serverUrl" else serverUrl
                    viewModel.setServerUrl(url) { onSetupComplete() }
                }
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (uiState.isLoggingIn) {
                CircularProgressIndicator(
                    color = KindredColors.Paper,
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text(
                    text = "Connect",
                    style = KindredType.Button,
                    color = KindredColors.Paper,
                )
            }
        }

        // Error message
        if (uiState.error != null) {
            Text(
                text = uiState.error!!,
                style = KindredType.Caption,
                color = KindredColors.Rosehip,
                modifier = Modifier.padding(top = 8.dp, start = 24.dp, end = 24.dp),
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        // QR code hint
        Row(
            modifier = Modifier
                .clip(KindredShape.RadiusSM)
                .background(KindredColors.Canvas)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusSM)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.QrCodeScanner,
                contentDescription = null,
                tint = KindredColors.Pine,
                modifier = Modifier.size(20.dp),
            )
            Column {
                Text(
                    text = "Have a QR code?",
                    style = KindredType.Label,
                    color = KindredColors.Ash,
                )
                Text(
                    text = "Open Settings on the web app to find it",
                    style = KindredType.Micro,
                    color = KindredColors.Mist,
                )
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        // Demo mode link at bottom
        Text(
            text = "Just exploring? Try the demo",
            style = KindredType.body(13, FontWeight.Medium),
            color = KindredColors.Forest,
            modifier = Modifier
                .clickable { onSkipToDemo() }
                .padding(bottom = 32.dp),
        )
    }
}
