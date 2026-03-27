import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:frontline_app/core/config/app_config.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/core/router/app_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Initialize local offline storage
  await HiveService.init();

  // Initialize Supabase — credentials passed via --dart-define at build time
  await Supabase.initialize(
    url: AppConfig.supabaseUrl,
    anonKey: AppConfig.supabaseAnonKey,
  );

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
    final router = ref.watch(routerProvider);

    return MaterialApp.router(
      title: 'Frontline',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
    );
  }
}
