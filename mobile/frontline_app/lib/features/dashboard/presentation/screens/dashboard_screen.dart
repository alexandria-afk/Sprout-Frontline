import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/features/auth/providers/auth_provider.dart';
import 'package:frontline_app/features/dashboard/providers/dashboard_provider.dart';
import 'package:frontline_app/features/tasks/providers/tasks_provider.dart';
import 'package:frontline_app/features/shifts/data/models/shift_models.dart';
import 'package:frontline_app/features/shifts/providers/shifts_provider.dart';
import 'package:frontline_app/features/training/providers/training_provider.dart';
import 'package:frontline_app/features/forms/providers/forms_provider.dart';
import 'package:frontline_app/features/issues/providers/issues_provider.dart';
import 'package:frontline_app/features/announcements/providers/announcements_provider.dart';

// ── Design tokens from MOBILE_DESIGN.md ───────────────────────────────────────

class _C {
  _C._();
  // Surfaces
  static const background = Color(0xFFF2F2F7);
  static const surface1 = Color(0xFFFFFFFF);
  static const surface2 = Color(0xFFF2F2F7);
  static const surface3 = Color(0xFFE5E5EA);
  // Brand
  static const sproutGreen = Color(0xFF1D9E75);
  static const sproutGreenLight = Color(0xFFE1F5EE);
  // Semantic
  static const critical = Color(0xFFFF3B30);
  static const high = Color(0xFFFF9500);
  static const positive = Color(0xFF30D158);
  static const info = Color(0xFF0A84FF);
  // Text
  static const textPrimary = Color(0xFF1C1C1E);
  static const textSecondary = Color(0xFF8E8E93);
  static const textTertiary = Color(0xFFC7C7CC);
}

// ── Dashboard screen ──────────────────────────────────────────────────────────

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncSummary = ref.watch(dashboardSummaryProvider);

    return Scaffold(
      backgroundColor: _C.background,
      body: asyncSummary.when(
        loading: () => const _SkeletonHome(),
        error: (err, _) => _ErrorState(
          onRetry: () => ref.invalidate(dashboardSummaryProvider),
        ),
        data: (summary) => _HomeBody(summary: summary),
      ),
    );
  }
}

// ── Home body ─────────────────────────────────────────────────────────────────

class _HomeBody extends ConsumerWidget {
  final dynamic summary;
  const _HomeBody({required this.summary});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncTasks = ref.watch(myTasksProvider);
    final asyncShifts = ref.watch(myShiftsProvider);
    final asyncEnrollments = ref.watch(myEnrollmentsProvider);

    // Compute metrics from real provider data.
    final tasks = asyncTasks.valueOrNull ?? [];
    final shifts = asyncShifts.valueOrNull ?? [];
    final enrollments = asyncEnrollments.valueOrNull ?? [];

    final overdueCount = tasks.where((t) => t.isOverdue).length;
    final openIssueCount = tasks
        .where((t) => t.status == 'pending' || t.status == 'open' || t.status == 'in_progress')
        .length;
    final incompleteCourses = enrollments
        .where((e) => e.status != 'completed')
        .length;

    // Shifts this week.
    final now = DateTime.now();
    final weekStart = now.subtract(Duration(days: now.weekday - 1));
    final weekEnd = weekStart.add(const Duration(days: 7));
    final shiftsThisWeek = shifts.where((s) {
      final dt = DateTime.tryParse(s.startAt);
      return dt != null && dt.isAfter(weekStart) && dt.isBefore(weekEnd);
    }).length;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(dashboardSummaryProvider);
        ref.read(myTasksProvider.notifier).refresh();
        ref.read(myShiftsProvider.notifier).refresh();
        ref.invalidate(myEnrollmentsProvider);
      },
      color: _C.sproutGreen,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // Greeting header
          SliverToBoxAdapter(child: _GreetingHeader()),

          // Metric cards — 2x2 grid
          SliverToBoxAdapter(
            child: _MetricGrid(
              overdueCount: overdueCount,
              openIssueCount: openIssueCount,
              incompleteCourses: incompleteCourses,
              shiftsThisWeek: shiftsThisWeek,
              totalTasks: tasks.length,
              totalEnrollments: enrollments.length,
            ),
          ),

          // TODO: Notification cards — AI/schedule-driven, stacked behind each other

          // Unified Inbox
          SliverToBoxAdapter(child: _InboxSection()),

          // My Shift section
          SliverToBoxAdapter(
            child: asyncShifts.when(
              loading: () => const SizedBox.shrink(),
              error: (e, st) => const SizedBox.shrink(),
              data: (shiftList) => _ShiftSection(shifts: shiftList),
            ),
          ),

          const SliverToBoxAdapter(child: SizedBox(height: 16)),
        ],
      ),
    );
  }
}

// ── Greeting header ───────────────────────────────────────────────────────────

class _GreetingHeader extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? 'Good morning'
        : hour < 17
            ? 'Good afternoon'
            : 'Good evening';

    return Padding(
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + 16,
        left: 16,
        right: 16,
        bottom: 8,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(greeting,
                    style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                        color: _C.textPrimary)),
              ],
            ),
          ),
          GestureDetector(
            onTap: () => _showProfileSheet(context, ref),
            child: const CircleAvatar(
              radius: 18,
              backgroundColor: _C.surface3,
              child:
                  Icon(Icons.person_outline, size: 20, color: _C.textSecondary),
            ),
          ),
        ],
      ),
    );
  }

  void _showProfileSheet(BuildContext context, WidgetRef ref) {
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
                color: _C.surface3,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 16),
            const CircleAvatar(
              radius: 28,
              backgroundColor: _C.surface3,
              child: Icon(Icons.person, size: 28, color: _C.textSecondary),
            ),
            const SizedBox(height: 12),
            const Text('My Profile',
                style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: _C.textPrimary)),
            const SizedBox(height: 24),
            ListTile(
              leading: const Icon(Icons.logout, color: Colors.red),
              title: const Text('Sign Out',
                  style: TextStyle(color: Colors.red)),
              onTap: () {
                Navigator.pop(context);
                ref.read(authSessionProvider.notifier).signOut();
              },
            ),
            const SizedBox(height: 8),
          ],
        ),
      ),
    );
  }
}

// ── Metric cards (2x2 grid) ───────────────────────────────────────────────────

class _MetricGrid extends StatelessWidget {
  final int overdueCount;
  final int openIssueCount;
  final int incompleteCourses;
  final int shiftsThisWeek;
  final int totalTasks;
  final int totalEnrollments;

  const _MetricGrid({
    required this.overdueCount,
    required this.openIssueCount,
    required this.incompleteCourses,
    required this.shiftsThisWeek,
    required this.totalTasks,
    required this.totalEnrollments,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _MetricCard(
                  value: overdueCount.toString(),
                  label: 'Overdue Items',
                  detail: overdueCount == 0
                      ? 'All on track'
                      : 'of $totalTasks total tasks',
                  color: overdueCount > 0 ? _C.critical : _C.positive,
                  onTap: () => context.go('/tasks'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _MetricCard(
                  value: openIssueCount.toString(),
                  label: 'Open Issues',
                  detail: openIssueCount == 0
                      ? 'Nothing to report'
                      : 'Needs attention',
                  color: openIssueCount > 0 ? _C.high : _C.positive,
                  onTap: () => context.go('/issues/report'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _MetricCard(
                  value: incompleteCourses.toString(),
                  label: 'Courses to Complete',
                  detail: totalEnrollments > 0
                      ? 'of $totalEnrollments enrolled'
                      : 'No courses assigned',
                  color: incompleteCourses > 0 ? _C.info : _C.positive,
                  onTap: () => context.go('/training'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: _MetricCard(
                  value: shiftsThisWeek.toString(),
                  label: 'Shifts This Week',
                  detail: shiftsThisWeek == 0
                      ? 'No shifts scheduled'
                      : 'Upcoming',
                  color: _C.sproutGreen,
                  onTap: () => context.go('/shifts'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  final String value;
  final String label;
  final String detail;
  final Color color;
  final VoidCallback onTap;

  const _MetricCard({
    required this.value,
    required this.label,
    required this.detail,
    required this.color,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _C.surface1,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              value,
              style: TextStyle(
                fontSize: 28,
                fontWeight: FontWeight.bold,
                color: color,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: _C.textPrimary,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              detail,
              style: const TextStyle(
                fontSize: 12,
                color: _C.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Card section wrapper (outer card) ─────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final String label;
  final String? route;
  final Widget child;
  const _SectionCard({required this.label, this.route, required this.child});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: _C.surface1,
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(label,
                    style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: _C.textSecondary,
                        letterSpacing: 0.8)),
                const Spacer(),
                if (route != null)
                  GestureDetector(
                    onTap: () => context.go(route!),
                    child: const Icon(Icons.north_east,
                        size: 16, color: _C.textTertiary),
                  ),
              ],
            ),
            const SizedBox(height: 12),
            child,
          ],
        ),
      ),
    );
  }
}

// ── Inner row (items inside a card section) ───────────────────────────────────

class _InnerRow extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;
  const _InnerRow({required this.child, this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: _C.surface2,
          borderRadius: BorderRadius.circular(10),
        ),
        child: child,
      ),
    );
  }
}

// ── Unified Inbox section ─────────────────────────────────────────────────────

/// An inbox item from any source (task, form, issue, course, announcement).
class _InboxItem {
  final String kind; // task, form, issue, course, announcement
  final String id;
  final String title;
  final String subtitle;
  final DateTime? due;
  final bool overdue;
  final String route;

  const _InboxItem({
    required this.kind,
    required this.id,
    required this.title,
    required this.subtitle,
    this.due,
    required this.overdue,
    required this.route,
  });
}

const _kindMeta = <String, (IconData, Color, String)>{
  'task':         (Icons.assignment,           Color(0xFF1D9E75), 'Task'),
  'form':         (Icons.checklist,            Color(0xFFD97706), 'Form'),
  'issue':        (Icons.warning_amber,        Color(0xFFFF9500), 'Issue'),
  'course':       (Icons.school,               Color(0xFF0A84FF), 'Training'),
  'announcement': (Icons.campaign,             Color(0xFF7C3AED), 'Acknowledge'),
};

class _InboxSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = DateTime.now();
    final items = <_InboxItem>[];

    // Tasks (not completed)
    final tasks = ref.watch(myTasksProvider).valueOrNull ?? [];
    for (final t in tasks) {
      if (t.status == 'completed' || t.status == 'cancelled') continue;
      final due = t.dueAt != null ? DateTime.tryParse(t.dueAt!) : null;
      items.add(_InboxItem(
        kind: 'task',
        id: t.id,
        title: t.title,
        subtitle: t.priority,
        due: due,
        overdue: t.isOverdue,
        route: '/tasks/${t.id}',
      ));
    }

    // Form assignments
    final forms = ref.watch(formsProvider).valueOrNull ?? [];
    for (final f in forms) {
      if (!f.isActive) continue;
      final due = f.dueAt != null ? DateTime.tryParse(f.dueAt!) : null;
      items.add(_InboxItem(
        kind: 'form',
        id: f.id,
        title: f.templateTitle,
        subtitle: f.templateType,
        due: due,
        overdue: due != null && due.isBefore(now),
        route: '/forms/fill/${f.id}',
      ));
    }

    // Issues (open / in_progress)
    final issues = ref.watch(myIssuesProvider).valueOrNull ?? [];
    for (final i in issues) {
      if (i.status == 'resolved' || i.status == 'verified_closed') continue;
      items.add(_InboxItem(
        kind: 'issue',
        id: i.id,
        title: i.title,
        subtitle: i.status.replaceAll('_', ' '),
        due: null,
        overdue: false,
        route: '/issues',
      ));
    }

    // Course enrollments (not completed)
    final enrollments = ref.watch(myEnrollmentsProvider).valueOrNull ?? [];
    for (final e in enrollments) {
      if (e.status == 'completed') continue;
      items.add(_InboxItem(
        kind: 'course',
        id: e.id,
        title: 'Training course',
        subtitle: e.status == 'in_progress' ? 'In progress' : 'Not started',
        due: null,
        overdue: false,
        route: '/training',
      ));
    }

    // Announcements requiring acknowledgement
    final announcements =
        ref.watch(announcementsProvider).valueOrNull ?? [];
    for (final a in announcements) {
      if (!a.requiresAcknowledgement || a.isAcknowledged) continue;
      items.add(_InboxItem(
        kind: 'announcement',
        id: a.id,
        title: a.title,
        subtitle: 'Acknowledgement required',
        due: null,
        overdue: false,
        route: '/announcements',
      ));
    }

    // Sort: overdue first, then by due date ascending, then no-due last
    items.sort((a, b) {
      if (a.overdue != b.overdue) return a.overdue ? -1 : 1;
      if (a.due != null && b.due != null) return a.due!.compareTo(b.due!);
      if (a.due != null) return -1;
      if (b.due != null) return 1;
      return 0;
    });

    final display = items.take(5).toList();
    if (display.isEmpty) return const SizedBox.shrink();

    return _SectionCard(
      label: 'MY INBOX',
      route: '/tasks',
      child: Column(
        children: display.map((item) {
          final meta = _kindMeta[item.kind]!;
          final icon = meta.$1;
          final color = item.overdue ? _C.critical : meta.$2;
          final kindLabel = meta.$3;

          String detail = kindLabel;
          if (item.overdue && item.due != null) {
            final diff = now.difference(item.due!);
            detail = 'Overdue by ${_humanDuration(diff)}';
          } else if (item.due != null) {
            detail = '$kindLabel · ${DateFormat('MMM d, h:mm a').format(item.due!.toLocal())}';
          } else {
            detail = '$kindLabel · ${item.subtitle}';
          }

          return _InnerRow(
            onTap: () => context.go(item.route),
            child: Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: color.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Icon(icon, size: 16, color: color),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(item.title,
                          style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: _C.textPrimary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis),
                      Text(detail,
                          style: TextStyle(
                              fontSize: 12,
                              color: item.overdue
                                  ? _C.critical
                                  : _C.textSecondary)),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right,
                    size: 16, color: _C.textTertiary),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

String _humanDuration(Duration d) {
  if (d.inDays > 0) return '${d.inDays}d';
  if (d.inHours > 0) return '${d.inHours}h';
  return '${d.inMinutes}m';
}

// ── My Shift section ──────────────────────────────────────────────────────────

class _ShiftSection extends StatelessWidget {
  final List<Shift> shifts;
  const _ShiftSection({required this.shifts});

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    // Find today's shift or next upcoming
    final todayShifts = shifts.where((s) {
      final start = DateTime.tryParse(s.startAt)?.toLocal();
      return start != null &&
          start.year == now.year &&
          start.month == now.month &&
          start.day == now.day;
    }).toList();

    if (todayShifts.isEmpty && shifts.isEmpty) return const SizedBox.shrink();

    final display = todayShifts.isNotEmpty ? todayShifts.first : shifts.first;
    final start = DateTime.tryParse(display.startAt)?.toLocal();
    final end = DateTime.tryParse(display.endAt)?.toLocal();
    final isActive = start != null && end != null &&
        now.isAfter(start) && now.isBefore(end);

    return _SectionCard(
      label: 'MY SHIFT',
      route: '/shifts',
      child: _InnerRow(
        onTap: () => context.go('/shifts'),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: isActive
                    ? _C.sproutGreenLight
                    : _C.surface3,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(
                isActive ? Icons.timer : Icons.schedule,
                color: isActive ? _C.sproutGreen : _C.textSecondary,
                size: 20,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    start != null && end != null
                        ? '${DateFormat('h:mm a').format(start)} – ${DateFormat('h:mm a').format(end)}'
                        : 'Scheduled',
                    style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: _C.textPrimary),
                  ),
                  Text(
                    isActive
                        ? 'In progress'
                        : display.locationName ?? 'Upcoming',
                    style: const TextStyle(
                        fontSize: 13, color: _C.textSecondary),
                  ),
                ],
              ),
            ),
            if (isActive)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _C.sproutGreen.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text('ACTIVE',
                    style: TextStyle(
                        color: _C.sproutGreen,
                        fontSize: 11,
                        fontWeight: FontWeight.w700)),
              ),
          ],
        ),
      ),
    );
  }
}

// ── Audit score section ───────────────────────────────────────────────────────

class _SidekickSheet extends StatefulWidget {
  @override
  State<_SidekickSheet> createState() => _SidekickSheetState();
}

class _SidekickSheetState extends State<_SidekickSheet> {
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
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: _C.surface3,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Row(
                children: [
                  Container(
                    width: 28,
                    height: 28,
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
            // Suggestion chips
            SizedBox(
              height: 36,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  _SuggestionChip(
                    label: "What's overdue?",
                    onTap: () => _controller.text = "What's overdue?",
                  ),
                  _SuggestionChip(
                    label: 'Summarize my day',
                    onTap: () => _controller.text = 'Summarize my day',
                  ),
                  _SuggestionChip(
                    label: "Who's on shift?",
                    onTap: () => _controller.text = "Who's on shift?",
                  ),
                ],
              ),
            ),
            const Spacer(),
            // Input bar
            Container(
              padding: EdgeInsets.only(
                left: 12, right: 8, top: 8,
                bottom: MediaQuery.of(context).padding.bottom + 8,
              ),
              decoration: const BoxDecoration(
                border: Border(
                    top: BorderSide(color: _C.surface3)),
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
                        color: _C.sproutGreen),
                    onPressed: () {
                      // TODO: Wire to POST /api/v1/ai/chat
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                            content: Text('AI chat coming soon')),
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
}

class _SuggestionChip extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _SuggestionChip({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: _C.surface2,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: _C.surface3),
          ),
          child: Text(label, style: const TextStyle(fontSize: 13)),
        ),
      ),
    );
  }
}

// ── Skeleton loading ──────────────────────────────────────────────────────────

class _SkeletonHome extends StatelessWidget {
  const _SkeletonHome();

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Greeting placeholder
            Container(
              width: 180,
              height: 24,
              decoration: BoxDecoration(
                color: _C.surface3,
                borderRadius: BorderRadius.circular(6),
              ),
            ),
            const SizedBox(height: 24),
            // Ring placeholders
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(
                3,
                (_) => Container(
                  width: 76,
                  height: 76,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(color: _C.surface3, width: 6),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
            // Card placeholders
            ...List.generate(
              2,
              (_) => Container(
                width: double.infinity,
                height: 100,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: _C.surface1,
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Error state ───────────────────────────────────────────────────────────────

class _ErrorState extends StatelessWidget {
  final VoidCallback onRetry;
  const _ErrorState({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.wifi_off_outlined,
              size: 48, color: _C.textSecondary),
          const SizedBox(height: 16),
          const Text('Could not load dashboard',
              style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w600,
                  color: _C.textPrimary)),
          const SizedBox(height: 24),
          GestureDetector(
            onTap: onRetry,
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: 24, vertical: 12),
              decoration: BoxDecoration(
                color: _C.sproutGreen,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Text('Retry',
                  style: TextStyle(
                      color: Colors.white,
                      fontSize: 15,
                      fontWeight: FontWeight.w600)),
            ),
          ),
        ],
      ),
    );
  }
}
