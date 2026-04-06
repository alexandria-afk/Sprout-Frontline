import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:frontline_app/core/i18n/language_provider.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/l10n/app_localizations.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _saving = false;

  Future<void> _changeLanguage(String languageCode) async {
    setState(() => _saving = true);
    try {
      final locale = Locale(languageCode);
      await ref.read(localeProvider.notifier).setLocale(locale);

      // Persist to server (best-effort — don't block on failure)
      final userId = Supabase.instance.client.auth.currentUser?.id;
      if (userId != null) {
        try {
          await DioClient.instance.patch(
            '/api/v1/users/$userId',
            data: {'language': languageCode},
          );
        } catch (_) {}
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currentLocale = ref.watch(localeProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.settingsTitle),
        backgroundColor: const Color(0xFF1E2A4A), // sprout-navy
        foregroundColor: Colors.white,
        elevation: 0,
      ),
      backgroundColor: const Color(0xFFF5F5F5),
      body: ListView(
        children: [
          const SizedBox(height: 16),
          // ── Language section ───────────────────────────────────
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(
              l10n.settingsLanguage,
              style: theme.textTheme.labelLarge?.copyWith(
                color: Colors.grey[600],
                letterSpacing: 0.5,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Card(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            child: _saving
                ? const Padding(
                    padding: EdgeInsets.all(20),
                    child: Center(child: CircularProgressIndicator()),
                  )
                : Column(
                    children: [
                      _LanguageTile(
                        label: l10n.languageEnglish,
                        languageCode: 'en',
                        selected: currentLocale.languageCode == 'en',
                        onTap: () => _changeLanguage('en'),
                      ),
                      const Divider(height: 1, indent: 16, endIndent: 16),
                      _LanguageTile(
                        label: l10n.languageThai,
                        languageCode: 'th',
                        selected: currentLocale.languageCode == 'th',
                        onTap: () => _changeLanguage('th'),
                      ),
                    ],
                  ),
          ),
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _LanguageTile extends StatelessWidget {
  final String label;
  final String languageCode;
  final bool selected;
  final VoidCallback onTap;

  const _LanguageTile({
    required this.label,
    required this.languageCode,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      title: Text(label),
      trailing: selected
          ? const Icon(Icons.check_circle, color: Color(0xFF22C55E))
          : const Icon(Icons.radio_button_unchecked, color: Colors.grey),
      onTap: selected ? null : onTap,
    );
  }
}
