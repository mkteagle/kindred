package com.kindlingsignal.kindred.ui.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.outlined.PlayCircle
import androidx.compose.material3.Icon
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.kindlingsignal.kindred.data.demo.DemoDataProvider
import com.kindlingsignal.kindred.ui.components.KindredAvatar
import com.kindlingsignal.kindred.ui.components.KindredEyebrow
import com.kindlingsignal.kindred.ui.theme.KindredColors
import com.kindlingsignal.kindred.ui.theme.KindredShape
import com.kindlingsignal.kindred.ui.theme.KindredType
import java.util.Calendar

/**
 * Settings screen with profile card, household members, library settings,
 * privacy section, sign out, and footer.
 * Matches iOS SettingsView.
 */
@Composable
fun SettingsScreen(
    onEnterDemo: () -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val scrollState = rememberScrollState()
    var autoBackupEnabled by remember { mutableStateOf(true) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(KindredColors.Paper)
            .verticalScroll(scrollState)
            .statusBarsPadding(),
    ) {
        // Page header
        Column(
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(top = 10.dp, bottom = 4.dp),
        ) {
            KindredEyebrow(text = "Settings")
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Your household.",
                style = KindredType.H2,
                color = KindredColors.Ash,
            )
        }

        // Profile / Household card
        HouseholdCard()

        // Members section
        MembersSection()

        // Library section
        LibrarySection(
            autoBackupEnabled = autoBackupEnabled,
            onAutoBackupChange = { autoBackupEnabled = it },
        )

        // Privacy section
        PrivacySection()

        // Developer section (demo mode)
        if (!DemoDataProvider.isActive) {
            DemoSection(onEnterDemo = onEnterDemo)
        }

        // Sign Out button
        SignOutButton()

        // Footer
        SettingsFooter()

        // Bottom spacer
        Spacer(modifier = Modifier.height(120.dp))
    }
}

@Composable
private fun HouseholdCard() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 16.dp)
            .shadow(
                elevation = 13.dp,
                shape = KindredShape.RadiusMD,
                ambientColor = KindredColors.CardShadow,
                spotColor = KindredColors.CardShadow,
            )
            .clip(KindredShape.RadiusMD)
            .background(KindredColors.Card)
            .border(1.dp, KindredColors.Line, KindredShape.RadiusMD)
            .padding(16.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Avatar
            KindredAvatar(
                url = if (DemoDataProvider.isActive) "demo://file_family-campfire-1" else null,
                size = 44.dp,
                borderWidth = 2.dp,
            )

            Column {
                Text(
                    text = "Demo User",
                    style = KindredType.display(17),
                    color = KindredColors.Ash,
                )
                Text(
                    text = "@demo \u00b7 member",
                    style = KindredType.Meta,
                    color = KindredColors.Mist,
                )
            }

            Spacer(modifier = Modifier.weight(1f))
        }

        // Unlimited storage
        Row(
            modifier = Modifier.padding(top = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "\u221e",
                style = KindredType.body(14, FontWeight.Medium),
                color = KindredColors.Forest,
            )
            Text(
                text = "Unlimited storage via Flickr",
                style = KindredType.Meta,
                color = KindredColors.Mist,
            )
        }
    }
}

@Composable
private fun MembersSection() {
    Column(
        modifier = Modifier.padding(top = 20.dp),
    ) {
        KindredEyebrow(
            text = "Household",
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(bottom = 6.dp),
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(KindredShape.RadiusMD)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusMD),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 14.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                // Member avatar
                Box(
                    modifier = Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(KindredColors.Canvas),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "D",
                        style = KindredType.display(14),
                        color = KindredColors.Pine,
                    )
                }

                Text(
                    text = "Demo User",
                    style = KindredType.Label,
                    color = KindredColors.Ash,
                )

                Spacer(modifier = Modifier.weight(1f))

                Text(
                    text = "MEMBER",
                    style = KindredType.Micro,
                    color = KindredColors.Mist,
                )
            }
        }
    }
}

@Composable
private fun LibrarySection(
    autoBackupEnabled: Boolean,
    onAutoBackupChange: (Boolean) -> Unit,
) {
    Column(
        modifier = Modifier.padding(top = 20.dp),
    ) {
        KindredEyebrow(
            text = "Library",
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(bottom = 6.dp),
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(KindredShape.RadiusMD)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusMD),
        ) {
            // Backup & storage
            SettingsRow(
                title = "Backup & storage",
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "Connected",
                            style = KindredType.Micro,
                            color = KindredColors.Forest,
                        )
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = KindredColors.Mist,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                },
            )

            SettingsDivider()

            // Auto-backup
            SettingsRow(
                title = "Auto-backup",
                trailing = {
                    Switch(
                        checked = autoBackupEnabled,
                        onCheckedChange = onAutoBackupChange,
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = KindredColors.Paper,
                            checkedTrackColor = KindredColors.Forest,
                            uncheckedThumbColor = KindredColors.Mist,
                            uncheckedTrackColor = KindredColors.Canvas,
                        ),
                        modifier = Modifier.height(24.dp),
                    )
                },
            )

            SettingsDivider()

            // Intelligence
            SettingsRow(
                title = "Intelligence",
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "On",
                            style = KindredType.Micro,
                            color = KindredColors.Forest,
                        )
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = KindredColors.Mist,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                },
            )

            SettingsDivider()

            // Notifications
            SettingsRow(
                title = "Notifications",
                trailing = {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                        contentDescription = null,
                        tint = KindredColors.Mist,
                        modifier = Modifier.size(14.dp),
                    )
                },
            )
        }
    }
}

@Composable
private fun PrivacySection() {
    Column(
        modifier = Modifier.padding(top = 20.dp),
    ) {
        KindredEyebrow(
            text = "Privacy",
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(bottom = 6.dp),
        )

        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(KindredShape.RadiusMD)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusMD),
        ) {
            // Library is private
            SettingsRow(
                title = "Library is private",
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = "Confirmed",
                            style = KindredType.Micro,
                            color = KindredColors.Forest,
                        )
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = KindredColors.Mist,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                },
            )

            SettingsDivider()

            // Backend status
            SettingsRow(
                title = "Backend status",
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(
                                    if (DemoDataProvider.isActive) KindredColors.Gold
                                    else KindredColors.Rosehip
                                ),
                        )
                        Text(
                            text = if (DemoDataProvider.isActive) "Demo Mode" else "Offline",
                            style = KindredType.Micro,
                            color = KindredColors.Mist,
                        )
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                            contentDescription = null,
                            tint = KindredColors.Mist,
                            modifier = Modifier.size(14.dp),
                        )
                    }
                },
            )
        }
    }
}

@Composable
private fun DemoSection(onEnterDemo: () -> Unit) {
    Column(
        modifier = Modifier.padding(top = 20.dp),
    ) {
        KindredEyebrow(
            text = "Developer",
            modifier = Modifier
                .padding(horizontal = 20.dp)
                .padding(bottom = 8.dp),
        )

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .clip(KindredShape.RadiusMD)
                .background(KindredColors.Card)
                .border(1.dp, KindredColors.Line, KindredShape.RadiusMD)
                .clickable { onEnterDemo() }
                .padding(14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.PlayCircle,
                contentDescription = null,
                tint = KindredColors.Forest,
                modifier = Modifier.size(20.dp),
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Try the demo",
                    style = KindredType.Label,
                    color = KindredColors.Ash,
                )
                Text(
                    text = "Explore with sample data, no account needed",
                    style = KindredType.Meta,
                    color = KindredColors.Mist,
                )
            }
            Icon(
                imageVector = Icons.AutoMirrored.Filled.KeyboardArrowRight,
                contentDescription = null,
                tint = KindredColors.Ember,
                modifier = Modifier.size(16.dp),
            )
        }
    }
}

@Composable
private fun SignOutButton() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .padding(top = 20.dp)
            .clip(KindredShape.RadiusMD)
            .background(KindredColors.Ember)
            .clickable { /* TODO: sign out */ }
            .padding(vertical = 14.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = "Sign Out",
            style = KindredType.Button,
            color = KindredColors.Paper,
        )
    }
}

@Composable
private fun SettingsFooter() {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Kindling Signal",
                style = KindredType.Meta,
                color = KindredColors.Mist,
            )
        }

        Text(
            text = "Kindred Photos \u00b7 v1.0",
            style = KindredType.Micro,
            color = KindredColors.Muted,
        )

        val year = Calendar.getInstance().get(Calendar.YEAR)
        Text(
            text = "\u00a9 $year Kindling Signal",
            style = KindredType.Micro,
            color = KindredColors.Muted,
        )
    }
}

@Composable
private fun SettingsRow(
    title: String,
    trailing: @Composable () -> Unit = {},
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = KindredType.Label,
            color = KindredColors.Ash,
            modifier = Modifier.weight(1f),
        )
        trailing()
    }
}

@Composable
private fun SettingsDivider() {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 14.dp)
            .height(0.5.dp)
            .background(KindredColors.Line),
    )
}
