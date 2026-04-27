package com.kindlingsignal.kindred.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Join household screen for new members with an invite code.
 */
@Composable
fun JoinScreen(
    viewModel: AuthViewModel,
    onBack: () -> Unit,
    onJoinSuccess: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val focusManager = LocalFocusManager.current

    var inviteCode by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var displayName by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    // Navigate on success
    LaunchedEffect(uiState.loginSuccess) {
        if (uiState.loginSuccess) {
            onJoinSuccess()
        }
    }

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
        // Back button
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        ) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = "Back",
                tint = KindredColors.Pine,
                modifier = Modifier
                    .size(24.dp)
                    .clickable { onBack() },
            )
        }

        Spacer(modifier = Modifier.height(20.dp))

        // App icon
        Box(
            modifier = Modifier
                .size(60.dp)
                .shadow(12.dp, RoundedCornerShape(15.dp), ambientColor = KindredColors.CardShadow, spotColor = KindredColors.CardShadow)
                .clip(RoundedCornerShape(15.dp))
                .background(KindredColors.Ember),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "K",
                style = KindredType.display(30),
                color = KindredColors.Card,
            )
        }

        Text(
            text = "Join a household.",
            style = KindredType.display(26, FontWeight.Bold),
            color = KindredColors.Ash,
            modifier = Modifier.padding(top = 16.dp),
        )

        Text(
            text = "Enter your invite code to get started.",
            style = KindredType.Body,
            color = KindredColors.Pine,
            modifier = Modifier.padding(top = 6.dp),
        )

        // Form fields
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            KindredInputField(
                label = "INVITE CODE",
                placeholder = "ABC123",
                value = inviteCode,
                onValueChange = { inviteCode = it.uppercase() },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    imeAction = ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) },
                ),
            )

            KindredInputField(
                label = "USERNAME",
                placeholder = "your_username",
                value = username,
                onValueChange = { username = it },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Ascii,
                    imeAction = ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) },
                ),
            )

            KindredInputField(
                label = "DISPLAY NAME",
                placeholder = "Your Name",
                value = displayName,
                onValueChange = { displayName = it },
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Words,
                    imeAction = ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) },
                ),
            )

            KindredInputField(
                label = "PASSWORD",
                placeholder = "6+ characters",
                value = password,
                onValueChange = { password = it },
                isPassword = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(
                    onDone = { focusManager.clearFocus() },
                ),
            )
        }

        // Join button
        val canJoin = inviteCode.isNotBlank() && username.isNotBlank() &&
                displayName.isNotBlank() && password.length >= 6 && !uiState.isLoggingIn

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 20.dp)
                .clip(KindredShape.RadiusSM)
                .background(if (canJoin) KindredColors.Ember else KindredColors.Ember.copy(alpha = 0.5f))
                .clickable(enabled = canJoin) {
                    viewModel.register(inviteCode, username, displayName, password)
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
                    text = "Join household",
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

        if (password.isNotEmpty() && password.length < 6) {
            Text(
                text = "Password must be at least 6 characters",
                style = KindredType.Micro,
                color = KindredColors.Mist,
                modifier = Modifier.padding(top = 4.dp),
            )
        }

        Spacer(modifier = Modifier.height(40.dp))
    }
}
