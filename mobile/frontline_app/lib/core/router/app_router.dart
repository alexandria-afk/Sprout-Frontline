import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/offline/connectivity_service.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/auth/providers/auth_provider.dart';
import 'package:frontline_app/features/auth/presentation/screens/login_screen.dart';
import 'package:frontline_app/features/dashboard/presentation/screens/dashboard_screen.dart';
import 'package:frontline_app/features/announcements/presentation/screens/announcements_screen.dart';
import 'package:frontline_app/features/forms/presentation/screens/forms_screen.dart';
import 'package:frontline_app/features/forms/presentation/screens/form_fill_screen.dart';
import 'package:frontline_app/features/issues/presentation/screens/issues_screen.dart';
import 'package:frontline_app/features/issues/presentation/screens/issue_detail_screen.dart';
import 'package:frontline_app/features/issues/presentation/screens/report_issue_screen.dart';
import 'package:frontline_app/features/shifts/presentation/screens/shifts_screen.dart';
import 'package:frontline_app/features/tasks/presentation/screens/tasks_screen.dart';
import 'package:frontline_app/features/tasks/presentation/screens/task_detail_screen.dart';
import 'package:frontline_app/features/training/presentation/screens/courses_screen.dart';
import 'package:frontline_app/features/training/presentation/screens/course_player_screen.dart';
import 'package:frontline_app/features/audits/presentation/screens/audit_templates_screen.dart';
import 'package:frontline_app/features/audits/presentation/screens/audit_fill_screen.dart';
import 'package:frontline_app/features/badges/presentation/screens/badges_screen.dart';
import 'package:frontline_app/features/approvals/presentation/screens/approvals_screen.dart';
import 'package:frontline_app/core/auth/role_provider.dart';
import 'package:frontline_app/features/approvals/providers/approvals_provider.dart';
import 'package:frontline_app/features/announcements/presentation/screens/create_announcement_screen.dart';
import 'package:frontline_app/features/tasks/presentation/screens/create_task_screen.dart';
import 'package:frontline_app/features/team/presentation/screens/team_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authSessionProvider);

  return GoRouter(
    initialLocation: '/login',
    redirect: (context, state) {
      final isLoggedIn = authState.valueOrNull != null;
      final isLoginRoute = state.matchedLocation == '/login';

      if (!isLoggedIn && !isLoginRoute) return '/login';
      if (isLoggedIn && isLoginRoute) return '/dashboard';

      // Role guard: manager-only routes redirect staff to dashboard.
      if (isLoggedIn) {
        final role = ref.read(userRoleProvider);
        const managerOnlyPaths = [
          '/approvals',
          '/team',
          '/announcements/create',
          '/tasks/create',
        ];
        if (role == 'staff' &&
            managerOnlyPaths
                .any((p) => state.matchedLocation.startsWith(p))) {
          return '/dashboard';
        }
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),

      // ── Full-screen routes (no bottom nav) ──────────────────────────────
      GoRoute(
        path: '/forms/fill/:id',
        builder: (context, state) => FormFillScreen(
          assignmentId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/issues/report',
        builder: (context, state) => const ReportIssueScreen(),
      ),
      GoRoute(
        path: '/issues/:id',
        builder: (context, state) => IssueDetailScreen(
          issueId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/tasks/create',
        builder: (context, state) => const CreateTaskScreen(),
      ),
      GoRoute(
        path: '/tasks/:id',
        builder: (context, state) => TaskDetailScreen(
          taskId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/announcements/create',
        builder: (context, state) => const CreateAnnouncementScreen(),
      ),
      GoRoute(
        path: '/training/:id',
        builder: (context, state) => CoursePlayerScreen(
          courseId: state.pathParameters['id']!,
        ),
      ),
      GoRoute(
        path: '/audits/fill/:id',
        builder: (context, state) => AuditFillScreen(
          templateId: state.pathParameters['id']!,
        ),
      ),

      // ── Tabbed shell routes ─────────────────────────────────────────────
      ShellRoute(
        builder: (context, state, child) => _AppShell(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            builder: (context, state) => const DashboardScreen(),
          ),
          GoRoute(
            path: '/tasks',
            builder: (context, state) => const TasksScreen(),
          ),
          GoRoute(
            path: '/issues',
            builder: (context, state) => const IssuesScreen(),
          ),
          GoRoute(
            path: '/shifts',
            builder: (context, state) => const ShiftsScreen(),
          ),
          GoRoute(
            path: '/forms',
            builder: (context, state) => const FormsScreen(),
          ),
          GoRoute(
            path: '/announcements',
            builder: (context, state) => const AnnouncementsScreen(),
          ),
          GoRoute(
            path: '/approvals',
            builder: (context, state) => const ApprovalsScreen(),
          ),
          GoRoute(
            path: '/team',
            builder: (context, state) => const TeamScreen(),
          ),
          GoRoute(
            path: '/training',
            builder: (context, state) => const CoursesScreen(),
          ),
          GoRoute(
            path: '/audits',
            builder: (context, state) => const AuditTemplatesScreen(),
          ),
          GoRoute(
            path: '/badges',
            builder: (context, state) => const BadgesScreen(),
          ),
        ],
      ),
    ],
  );
});

/// Bottom nav shell — 5 primary tabs plus a "More" menu for extra screens.
class _AppShell extends ConsumerWidget {
  final Widget child;
  const _AppShell({required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isOnline = ref.watch(connectivityProvider);
    final isManager = ref.watch(isManagerOrAboveProvider);
    final pendingCount =
        isManager ? ref.watch(pendingApprovalsCountProvider) : 0;

    const sproutGreen = Color(0xFF1D9E75);
    const textTertiary = Color(0xFFC7C7CC);

    return Scaffold(
      body: Column(
        children: [
          if (!isOnline) const _OfflineBanner(),
          Expanded(child: child),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        heroTag: 'sidekick_global',
        mini: false,
        onPressed: () => _showSidekick(context),
        backgroundColor: const Color(0xFF7C3AED),
        child: const Icon(Icons.auto_awesome, color: Colors.white, size: 22),
      ),
      bottomNavigationBar: Theme(
        data: Theme.of(context).copyWith(
          navigationBarTheme: NavigationBarThemeData(
            indicatorColor: sproutGreen.withValues(alpha: 0.12),
            iconTheme: WidgetStateProperty.resolveWith((states) {
              if (states.contains(WidgetState.selected)) {
                return const IconThemeData(color: sproutGreen);
              }
              return const IconThemeData(color: textTertiary);
            }),
            labelTextStyle: WidgetStateProperty.resolveWith((states) {
              if (states.contains(WidgetState.selected)) {
                return const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w500,
                    color: sproutGreen);
              }
              return const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w500,
                  color: textTertiary);
            }),
          ),
        ),
        child: NavigationBar(
          selectedIndex: _selectedIndex(context),
          onDestinationSelected: (i) => _onTap(context, ref, i),
          destinations: [
            const NavigationDestination(
                icon: Icon(Icons.home_outlined),
                selectedIcon: Icon(Icons.home),
                label: 'Home'),
            const NavigationDestination(
                icon: Icon(Icons.assignment_outlined),
                selectedIcon: Icon(Icons.assignment),
                label: 'Tasks'),
            const NavigationDestination(
                icon: Icon(Icons.warning_amber_outlined),
                selectedIcon: Icon(Icons.warning_amber),
                label: 'Issues'),
            NavigationDestination(
                icon: Badge(
                  isLabelVisible: pendingCount > 0,
                  label: Text('$pendingCount'),
                  child: const Icon(Icons.calendar_today_outlined),
                ),
                selectedIcon: Badge(
                  isLabelVisible: pendingCount > 0,
                  label: Text('$pendingCount'),
                  child: const Icon(Icons.calendar_today),
                ),
                label: 'Shifts'),
            const NavigationDestination(
                icon: Icon(Icons.menu),
                selectedIcon: Icon(Icons.menu),
                label: 'More'),
          ],
        ),
      ),
    );
  }

  int _selectedIndex(BuildContext context) {
    final loc = GoRouterState.of(context).matchedLocation;
    if (loc.startsWith('/tasks')) return 1;
    if (loc.startsWith('/issues')) return 2;
    if (loc.startsWith('/shifts')) return 3;
    if (loc.startsWith('/forms') ||
        loc.startsWith('/announcements') ||
        loc.startsWith('/audits') ||
        loc.startsWith('/badges') ||
        loc.startsWith('/training') ||
        loc.startsWith('/approvals') ||
        loc.startsWith('/team')) {
      return 4;
    }
    return 0;
  }

  void _onTap(BuildContext context, WidgetRef ref, int index) {
    switch (index) {
      case 0:
        context.go('/dashboard');
        break;
      case 1:
        context.go('/tasks');
        break;
      case 2:
        context.go('/issues');
        break;
      case 3:
        context.go('/shifts');
        break;
      case 4:
        _showMoreSheet(context, ref);
        break;
    }
  }

  void _showSidekick(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => _GlobalSidekickSheet(),
    );
  }

  void _showMoreSheet(BuildContext context, WidgetRef ref) {
    final isManager = ref.read(isManagerOrAboveProvider);

    showModalBottomSheet(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: 8),
            Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: SproutColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 12),
            _MoreTile(
              icon: Icons.checklist_outlined,
              label: 'Forms & Checklists',
              onTap: () {
                Navigator.pop(context);
                context.go('/forms');
              },
            ),
            _MoreTile(
              icon: Icons.campaign_outlined,
              label: 'Announcements',
              onTap: () {
                Navigator.pop(context);
                context.go('/announcements');
              },
            ),
            _MoreTile(
              icon: Icons.school_outlined,
              label: 'Training',
              onTap: () {
                Navigator.pop(context);
                context.go('/training');
              },
            ),
            _MoreTile(
              icon: Icons.military_tech_outlined,
              label: 'Badges & Leaderboard',
              onTap: () {
                Navigator.pop(context);
                context.go('/badges');
              },
            ),
            if (isManager)
              _MoreTile(
                icon: Icons.post_add,
                label: 'New Announcement',
                onTap: () {
                  Navigator.pop(context);
                  context.go('/announcements/create');
                },
              ),
            if (isManager)
              _MoreTile(
                icon: Icons.add_task,
                label: 'Create Task',
                onTap: () {
                  Navigator.pop(context);
                  context.go('/tasks/create');
                },
              ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

class _MoreTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  const _MoreTile(
      {required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: SproutColors.navy),
      title: Text(label),
      trailing:
          const Icon(Icons.chevron_right, color: SproutColors.bodyText),
      onTap: onTap,
    );
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 4,
        bottom: 4,
        left: 16,
        right: 16,
      ),
      color: SproutColors.darkText,
      child: const Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.cloud_off, size: 14, color: Colors.white70),
          SizedBox(width: 6),
          Text(
            'You\'re offline — changes will sync when reconnected',
            style: TextStyle(color: Colors.white70, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _GlobalSidekickSheet extends StatefulWidget {
  @override
  State<_GlobalSidekickSheet> createState() => _GlobalSidekickSheetState();
}

class _GlobalSidekickSheetState extends State<_GlobalSidekickSheet> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.55,
      maxChildSize: 0.85,
      minChildSize: 0.3,
      builder: (_, scrollCtrl) => Container(
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
        child: Column(
          children: [
            const SizedBox(height: 8),
            Container(
              width: 36, height: 4,
              decoration: BoxDecoration(
                color: SproutColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 28, height: 28,
                    decoration: BoxDecoration(
                      color: const Color(0xFF7C3AED),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.auto_awesome,
                        size: 16, color: Colors.white),
                  ),
                  const SizedBox(width: 10),
                  const Text('Sidekick',
                      style: TextStyle(
                          fontSize: 17, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  _chip("What's overdue?"),
                  _chip('Summarize my day'),
                  _chip("Who's on shift?"),
                ],
              ),
            ),
            const Spacer(),
            Container(
              padding: EdgeInsets.only(
                left: 12, right: 8, top: 8,
                bottom: MediaQuery.of(context).padding.bottom + 8,
              ),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: SproutColors.border)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: const InputDecoration(
                        hintText: 'Ask anything...',
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send,
                        color: SproutColors.green),
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('AI chat coming soon')),
                      );
                    },
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip(String label) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: GestureDetector(
        onTap: () => _controller.text = label,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: SproutColors.pageBg,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: SproutColors.border),
          ),
          child: Text(label, style: const TextStyle(fontSize: 13)),
        ),
      ),
    );
  }
}
