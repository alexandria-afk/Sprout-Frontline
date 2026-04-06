import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';

const _kLocaleKey = 'locale';

/// Exposes the current [Locale] and persists it to Hive.
///
/// Usage:
///   final locale = ref.watch(localeProvider);
///   ref.read(localeProvider.notifier).setLocale(const Locale('th'));
class LocaleNotifier extends Notifier<Locale> {
  @override
  Locale build() {
    final saved = _read();
    return saved != null ? Locale(saved) : const Locale('en');
  }

  String? _read() {
    try {
      return HiveService.preferences.get(_kLocaleKey);
    } catch (_) {
      return null;
    }
  }

  Future<void> setLocale(Locale locale) async {
    state = locale;
    try {
      await HiveService.preferences.put(_kLocaleKey, locale.languageCode);
    } catch (_) {}
  }

  /// Toggle between English and Thai.
  Future<void> toggle() async {
    final next = state.languageCode == 'en'
        ? const Locale('th')
        : const Locale('en');
    await setLocale(next);
  }
}

final localeProvider = NotifierProvider<LocaleNotifier, Locale>(
  LocaleNotifier.new,
);
