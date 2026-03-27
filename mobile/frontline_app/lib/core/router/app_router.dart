import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/features/auth/providers/auth_provider.dart';
import 'package:frontline_app/features/auth/presentation/screens/login_screen.dart';
import 'package:frontline_app/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:frontline_app/features/announcements/presentation/screens/announcements_screen.dart';
import 'package:frontline_app/features/forms/presentation/screens/forms_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authSessionProvider);

  return GoRouter(
    initialLocation: '/login',
    redirect: (context, state) {
      final isLoggedIn = authState.valueOrNull != null;
      final isLoginRoute = state.matchedLocation == '/login';

      if (!isLoggedIn && !isLoginRoute) return '/login';
      if (isLoggedIn && isLoginRoute) return '/dashboard';
      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      ShellRoute(
        builder: (context, state, child) => _AppShell(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/announcements',
            builder: (context, state) => const AnnouncementsScreen(),
          ),
          GoRoute(
            path: '/forms',
            builder: (context, state) => const FormsScreen(),
          ),
        ],
      ),
    ],
  );
});

/// Bottom navigation shell wrapping all dashboard routes
class _AppShell extends StatelessWidget {
  final Widget child;
  const _AppShell({required this.child});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: child,
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex(context),
        onDestinationSelected: (i) => _onTap(context, i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), label: 'Dashboard'),
          NavigationDestination(icon: Icon(Icons.campaign_outlined), label: 'Announcements'),
          NavigationDestination(icon: Icon(Icons.checklist_outlined), label: 'Forms'),
        ],
      ),
    );
  }

  int _selectedIndex(BuildContext context) {
    final location = GoRouterState.of(context).matchedLocation;
    if (location.startsWith('/announcements')) return 1;
    if (location.startsWith('/forms')) return 2;
    return 0;
  }

  void _onTap(BuildContext context, int index) {
    switch (index) {
      case 0: context.go('/dashboard'); break;
      case 1: context.go('/announcements'); break;
      case 2: context.go('/forms'); break;
    }
  }
}
