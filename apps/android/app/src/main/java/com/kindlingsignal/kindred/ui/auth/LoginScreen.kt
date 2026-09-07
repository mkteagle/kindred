package com.kindlingsignal.kindred.ui.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PlayCircleFilled
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType

/**
 * Login screen matching the iOS LoginView design.
 * Supports member login (username/password), Flickr OAuth (admin),
 * demo mode, and navigation to join-with-code.
 */
@Composable
fun LoginScreen(
    viewModel: AuthViewModel,
    onLoginSuccess: () -> Unit,
    onJoinClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val focusManager = LocalFocusManager.current

    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    // Navigate on success
    LaunchedEffect(uiState.loginSuccess) {
        if (uiState.loginSuccess) {
            onLoginSuccess()
        }
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Bg)
            .verticalScroll(rememberScrollState())
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(60.dp))

        // App icon
        Box(
            modifier = Modifier
                .size(74.dp)
                .shadow(15.dp, RoundedCornerShape(18.dp), ambientColor = KindredColors.Bg, spotColor = KindredColors.Bg)
                .clip(RoundedCornerShape(18.dp))
                .background(KindredColors.Terracotta),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "K",
                style = KindredType.display(36),
                color = KindredColors.OnAccentInk,
            )
        }

        // Welcome text
        Text(
            text = "Welcome back.",
            style = KindredType.display(26, FontWeight.Bold),
            color = KindredColors.InkPrimary,
            modifier = Modifier.padding(top = 18.dp),
        )

        Text(
            text = "Sign in to your household.",
            style = KindredType.Body,
            color = KindredColors.InkBody,
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
            // Username field
            KindredInputField(
                label = "EMAIL",
                placeholder = "username",
                value = username,
                onValueChange = { username = it },
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Next,
                ),
                keyboardActions = KeyboardActions(
                    onNext = { focusManager.moveFocus(FocusDirection.Down) },
                ),
            )

            // Password field
            KindredInputField(
                label = "PASSWORD",
                placeholder = "",
                value = password,
                onValueChange = { password = it },
                isPassword = true,
                keyboardOptions = KeyboardOptions(
                    keyboardType = KeyboardType.Password,
                    imeAction = ImeAction.Done,
                ),
                keyboardActions = KeyboardActions(
                    onDone = {
                        focusManager.clearFocus()
                        if (username.isNotBlank() && password.isNotBlank()) {
                            viewModel.login(username, password)
                        }
                    },
                ),
            )
        }

        // Sign in button
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 20.dp)
                .clip(KindredShape.Small)
                .background(
                    if (username.isNotBlank() && password.isNotBlank() && !uiState.isLoggingIn)
                        KindredColors.Terracotta
                    else
                        KindredColors.Terracotta.copy(alpha = 0.5f)
                )
                .clickable(enabled = username.isNotBlank() && password.isNotBlank() && !uiState.isLoggingIn) {
                    viewModel.login(username, password)
                }
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (uiState.isLoggingIn) {
                CircularProgressIndicator(
                    color = KindredColors.OnAccentInk,
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                )
            } else {
                Text(
                    text = "Sign in",
                    style = KindredType.Button,
                    color = KindredColors.OnAccentInk,
                )
            }
        }

        // Error message
        if (uiState.error != null) {
            Text(
                text = uiState.error!!,
                style = KindredType.BodySmall,
                color = KindredColors.DangerInk,
                modifier = Modifier.padding(top = 8.dp, start = 24.dp, end = 24.dp),
            )
        }

        // OR divider
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 22.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(1.dp)
                    .background(KindredColors.Hairline),
            )
            Text(
                text = "OR",
                style = KindredType.Micro,
                color = KindredColors.InkMeta,
            )
            Box(
                modifier = Modifier
                    .weight(1f)
                    .height(1.dp)
                    .background(KindredColors.Hairline),
            )
        }

        // Flickr login button
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .clip(KindredShape.Small)
                .background(KindredColors.SurfaceFill)
                .border(1.dp, KindredColors.HairlineStrong, KindredShape.Small)
                .clickable(enabled = !uiState.isFlickrLoggingIn) {
                    viewModel.startFlickrLogin(context)
                }
                .height(48.dp),
            contentAlignment = Alignment.Center,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (uiState.isFlickrLoggingIn) {
                    CircularProgressIndicator(
                        color = KindredColors.InkPrimary,
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    // Flickr brand gradient swatch
                    Box(
                        modifier = Modifier
                            .size(14.dp)
                            .clip(RoundedCornerShape(3.dp))
                            .background(
                                Brush.horizontalGradient(
                                    colors = listOf(
                                        Color(0xFF0063DC),
                                        Color(0xFFFF0084),
                                    ),
                                ),
                            ),
                    )
                }
                Text(
                    text = "Continue with Flickr",
                    style = KindredType.body(14, FontWeight.Bold),
                    color = KindredColors.InkPrimary,
                )
            }
        }

        // Join link
        Row(
            modifier = Modifier
                .clickable { onJoinClick() }
                .padding(top = 18.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = "New to Kindred?",
                style = KindredType.BodySmall,
                color = KindredColors.InkBody,
            )
            Text(
                text = "Join with code",
                style = KindredType.body(13, FontWeight.Bold),
                color = KindredColors.Terracotta,
            )
        }

        // Demo mode button
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(top = 12.dp)
                .clip(KindredShape.Small)
                .background(KindredColors.SageInk.copy(alpha = 0.08f))
                .clickable(enabled = !uiState.isDemoLoading) {
                    viewModel.enterDemo()
                }
                .height(44.dp),
            contentAlignment = Alignment.Center,
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Filled.PlayCircleFilled,
                    contentDescription = null,
                    tint = KindredColors.SageInk,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    text = "Try the demo",
                    style = KindredType.Label,
                    color = KindredColors.SageInk,
                )
            }
        }

        Spacer(modifier = Modifier.height(40.dp))
    }
}

/**
 * Kindred-styled input field with label.
 */
@Composable
fun KindredInputField(
    label: String,
    placeholder: String,
    value: String,
    onValueChange: (String) -> Unit,
    isPassword: Boolean = false,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions.Default,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = label,
            style = KindredType.Micro,
            color = KindredColors.InkMeta,
        )

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(KindredShape.Small)
                .background(KindredColors.SurfaceFill)
                .border(1.dp, KindredColors.Hairline, KindredShape.Small)
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            if (value.isEmpty() && placeholder.isNotEmpty()) {
                Text(
                    text = placeholder,
                    style = KindredType.Body,
                    color = KindredColors.InkMeta,
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = KindredType.Body.copy(color = KindredColors.InkPrimary),
                singleLine = true,
                visualTransformation = if (isPassword) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
                keyboardOptions = keyboardOptions,
                keyboardActions = keyboardActions,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
