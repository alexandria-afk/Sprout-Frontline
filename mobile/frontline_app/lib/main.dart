import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/core/offline/sync_service.dart';
import 'package:frontline_app/core/router/app_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/core/i18n/language_provider.dart';
import 'package:frontline_app/l10n/app_localizations.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize local offline storage
  await HiveService.init();

  runApp(
    // ProviderScope is the Riverpod root — must wrap the entire app
    const ProviderScope(
      child: FrontlineApp(),
    ),
  );
}

class FrontlineApp extends ConsumerWidget {
  const FrontlineApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Eagerly initialize the sync service so it listens for connectivity changes.
    ref.watch(syncServiceProvider);
    final router = ref.watch(routerProvider);

    final locale = ref.watch(localeProvider);

    return MaterialApp.router(
      title: 'Frontliner',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
    );
  }
}
