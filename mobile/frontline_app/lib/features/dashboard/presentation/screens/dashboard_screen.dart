import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:geolocator/geolocator.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:frontline_app/features/auth/providers/auth_provider.dart';
import 'package:frontline_app/features/dashboard/providers/dashboard_provider.dart';
import 'package:frontline_app/features/tasks/providers/tasks_provider.dart';
import 'package:frontline_app/features/shifts/data/models/shift_models.dart';
import 'package:frontline_app/features/shifts/providers/shifts_provider.dart';
import 'package:frontline_app/features/training/providers/training_provider.dart';
import 'package:frontline_app/features/announcements/providers/announcements_provider.dart';
import 'package:frontline_app/features/ai_insights/providers/ai_insights_provider.dart';
import 'package:frontline_app/features/ai_insights/data/models/ai_insight_models.dart';
import 'package:frontline_app/features/notifications/providers/notifications_provider.dart';
import 'package:frontline_app/features/badges/providers/badges_provider.dart';

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

    final tasks = asyncTasks.valueOrNull ?? [];
    final enrollments = asyncEnrollments.valueOrNull ?? [];

    final overdueCount = tasks.where((t) => t.isOverdue).length;
    final openIssueCount = tasks
        .where((t) =>
            t.status == 'pending' ||
            t.status == 'open' ||
            t.status == 'in_progress')
        .length;
    final incompleteCourses =
        enrollments.where((e) => e.status != 'completed').length;

    final now = DateTime.now();
    final weekStart = now.subtract(Duration(days: now.weekday - 1));
    final weekEnd = weekStart.add(const Duration(days: 7));
    final shifts = asyncShifts.valueOrNull ?? [];
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
        ref.read(aiInsightsProvider.notifier).refresh();
        ref.read(inboxNotificationsProvider.notifier).refresh();
        ref.invalidate(unreadCountProvider);
        ref.read(announcementsProvider.notifier).refresh();
      },
      color: _C.sproutGreen,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          // 0. Greeting header
          SliverToBoxAdapter(child: _GreetingHeader()),

          // 1. Stat cards — 2x2 grid
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

          // 2. AI Insight cards
          SliverToBoxAdapter(child: _AIInsightsSection()),

          // 3. My Shift
          SliverToBoxAdapter(
            child: asyncShifts.when(
              loading: () => const SizedBox.shrink(),
              error: (_, _) => const SizedBox.shrink(),
              data: (shiftList) => _ShiftSection(shifts: shiftList),
            ),
          ),

          // 4. Inbox (notifications)
          SliverToBoxAdapter(child: _InboxSection()),

          // 5. Leaderboard
          SliverToBoxAdapter(child: _LeaderboardSection()),

          // 6. Latest Announcements
          SliverToBoxAdapter(child: _AnnouncementsSection()),

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
            onTap: () => context.go('/issues/report'),
            child: Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: _C.sproutGreen,
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(Icons.add, size: 20, color: Colors.white),
            ),
          ),
          const SizedBox(width: 10),
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
              title:
                  const Text('Sign Out', style: TextStyle(color: Colors.red)),
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
            Text(value,
                style: TextStyle(
                    fontSize: 28, fontWeight: FontWeight.bold, color: color)),
            const SizedBox(height: 4),
            Text(label,
                style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: _C.textPrimary)),
            const SizedBox(height: 2),
            Text(detail,
                style:
                    const TextStyle(fontSize: 12, color: _C.textSecondary)),
          ],
        ),
      ),
    );
  }
}

// ── Card section wrapper (outer card) ─────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final String label;
  final String? actionLabel;
  final String? route;
  final Widget child;
  const _SectionCard({
    required this.label,
    this.actionLabel,
    this.route,
    required this.child,
  });

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
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (actionLabel != null)
                          Text(actionLabel!,
                              style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w500,
                                  color: _C.sproutGreen)),
                        if (actionLabel == null)
                          const Icon(Icons.north_east,
                              size: 16, color: _C.textTertiary),
                      ],
                    ),
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
  final Color? backgroundColor;
  const _InnerRow({required this.child, this.onTap, this.backgroundColor});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: backgroundColor ?? _C.surface2,
          borderRadius: BorderRadius.circular(10),
        ),
        child: child,
      ),
    );
  }
}

// ── AI Insight cards ─────────────────────────────────────────────────────────

class _AIInsightsSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncInsights = ref.watch(aiInsightsProvider);
    final dismissed = ref.watch(dismissedInsightsProvider);

    return asyncInsights.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (response) {
        final visible = response.insights
            .where((i) => !dismissed.contains(i.dismissKey))
            .toList();
        if (visible.isEmpty) return const SizedBox.shrink();

        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            children: visible.map((insight) {
              return Dismissible(
                key: ValueKey(insight.dismissKey),
                direction: DismissDirection.startToEnd,
                onDismissed: (_) {
                  ref
                      .read(dismissedInsightsProvider.notifier)
                      .dismiss(insight.dismissKey);
                },
                background: Container(
                  alignment: Alignment.centerLeft,
                  padding: const EdgeInsets.only(left: 20),
                  margin: const EdgeInsets.only(bottom: 10),
                  decoration: BoxDecoration(
                    color: _C.surface3,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.check, color: _C.textSecondary),
                ),
                child: _AIInsightCard(insight: insight),
              );
            }).toList(),
          ),
        );
      },
    );
  }
}

class _AIInsightCard extends StatelessWidget {
  final AIInsight insight;
  const _AIInsightCard({required this.insight});

  @override
  Widget build(BuildContext context) {
    final (accentColor, icon) = switch (insight.severity) {
      'critical' => (_C.critical, '🔴'),
      'warning' => (_C.high, '⚠️'),
      _ => (_C.info, 'ℹ️'),
    };

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: _C.surface1,
        borderRadius: BorderRadius.circular(12),
        border: Border(left: BorderSide(color: accentColor, width: 3)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(icon, style: const TextStyle(fontSize: 14)),
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: accentColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(insight.severity.toUpperCase(),
                    style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: accentColor)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(insight.title,
              style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: _C.textPrimary)),
          const SizedBox(height: 4),
          Text(insight.body,
              style: const TextStyle(
                  fontSize: 13, color: _C.textSecondary, height: 1.4)),
          const SizedBox(height: 8),
          Text(insight.recommendation,
              style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: accentColor,
                  height: 1.4)),
        ],
      ),
    );
  }
}

// ── My Shift section (with clock in/out) ─────────────────────────────────────

class _ShiftSection extends ConsumerStatefulWidget {
  final List<Shift> shifts;
  const _ShiftSection({required this.shifts});

  @override
  ConsumerState<_ShiftSection> createState() => _ShiftSectionState();
}

class _ShiftSectionState extends ConsumerState<_ShiftSection> {
  bool _isLoading = false;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final activeAttendance = ref.watch(activeAttendanceProvider);

    // Find today's shift.
    final todayShifts = widget.shifts.where((s) {
      final start = DateTime.tryParse(s.startAt)?.toLocal();
      return start != null &&
          start.year == now.year &&
          start.month == now.month &&
          start.day == now.day;
    }).toList();

    // No shift today.
    if (todayShifts.isEmpty) {
      return _SectionCard(
        label: 'MY SHIFT',
        route: '/shifts',
        child: const Padding(
          padding: EdgeInsets.symmetric(vertical: 8),
          child: Text('No shift scheduled',
              style: TextStyle(fontSize: 14, color: _C.textSecondary)),
        ),
      );
    }

    final shift = todayShifts.first;
    final start = DateTime.tryParse(shift.startAt)?.toLocal();
    final end = DateTime.tryParse(shift.endAt)?.toLocal();
    final isClockedIn = activeAttendance != null;

    return _SectionCard(
      label: 'MY SHIFT',
      route: '/shifts',
      child: Column(
        children: [
          _InnerRow(
            onTap: () => context.go('/shifts'),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: isClockedIn ? _C.sproutGreenLight : _C.surface3,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    isClockedIn ? Icons.timer : Icons.schedule,
                    color: isClockedIn ? _C.sproutGreen : _C.textSecondary,
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
                        isClockedIn
                            ? 'Clocked in at ${DateFormat('h:mm a').format(DateTime.tryParse(activeAttendance.clockInAt)?.toLocal() ?? now)}'
                            : shift.locationName ?? 'Upcoming',
                        style: const TextStyle(
                            fontSize: 13, color: _C.textSecondary),
                      ),
                    ],
                  ),
                ),
                if (isClockedIn)
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
          // Action buttons
          if (!isClockedIn)
            _PrimaryButton(
              label: 'Clock In',
              isLoading: _isLoading,
              onTap: () => _clockIn(shift),
            ),
          if (isClockedIn)
            Row(
              children: [
                Expanded(
                  child: _SecondaryButton(
                    label: 'On Break',
                    onTap: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Break tracking coming soon')),
                      );
                    },
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: _DestructiveButton(
                    label: 'Clock Out',
                    isLoading: _isLoading,
                    onTap: () => _clockOut(activeAttendance),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }

  Future<void> _clockIn(Shift shift) async {
    setState(() => _isLoading = true);
    try {
      final position = await _getPosition();
      final repo = ref.read(shiftsRepositoryProvider);
      final attendance = await repo.clockIn(
        shiftId: shift.id,
        locationId: shift.locationId ?? '',
        latitude: position.latitude,
        longitude: position.longitude,
      );
      ref.read(activeAttendanceProvider.notifier).state = attendance;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Clock in failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _clockOut(AttendanceRecord? attendance) async {
    if (attendance == null) return;
    setState(() => _isLoading = true);
    try {
      final position = await _getPosition();
      final repo = ref.read(shiftsRepositoryProvider);
      await repo.clockOut(
        attendanceId: attendance.id,
        latitude: position.latitude,
        longitude: position.longitude,
      );
      ref.read(activeAttendanceProvider.notifier).state = null;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Clock out failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<Position> _getPosition() async {
    LocationPermission perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
    }
    if (perm == LocationPermission.deniedForever ||
        perm == LocationPermission.denied) {
      throw Exception('Location permission required');
    }
    return Geolocator.getCurrentPosition(
      locationSettings:
          const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }
}

// ── Inbox section (notifications) ────────────────────────────────────────────

const _notifTypeMeta = <String, (IconData, Color)>{
  'task_assigned': (Icons.assignment, Color(0xFF1D9E75)),
  'form_assigned': (Icons.checklist, Color(0xFFD97706)),
  'workflow_stage_assigned': (Icons.account_tree, Color(0xFF7C3AED)),
  'issue_assigned': (Icons.warning_amber, Color(0xFFFF9500)),
  'issue_comment': (Icons.chat_bubble_outline, Color(0xFF0A84FF)),
  'issue_status_changed': (Icons.sync, Color(0xFF0A84FF)),
  'shift_claim_pending': (Icons.schedule, Color(0xFF1D9E75)),
  'shift_swap_pending': (Icons.swap_horiz, Color(0xFF1D9E75)),
  'leave_request_pending': (Icons.event_busy, Color(0xFFFF9500)),
  'form_submission_review': (Icons.rate_review, Color(0xFFD97706)),
  'cap_generated': (Icons.gpp_bad, Color(0xFFFF3B30)),
  'announcement': (Icons.campaign, Color(0xFF7C3AED)),
  'course_enrolled': (Icons.school, Color(0xFF0A84FF)),
  'scheduled_reminder': (Icons.alarm, Color(0xFFFF9500)),
};

class _InboxSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncNotifs = ref.watch(inboxNotificationsProvider);

    return asyncNotifs.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (notifications) {
        if (notifications.isEmpty) {
          return _SectionCard(
            label: 'INBOX',
            child: const Padding(
              padding: EdgeInsets.symmetric(vertical: 8),
              child: Text('All caught up \u2713',
                  style: TextStyle(fontSize: 14, color: _C.textSecondary)),
            ),
          );
        }

        return _SectionCard(
          label: 'INBOX',
          actionLabel: 'View all \u2192',
          route: '/notifications',
          child: Column(
            children: [
              ...notifications.map((notif) {
                final meta =
                    _notifTypeMeta[notif.type] ?? (Icons.notifications, _C.info);
                final icon = meta.$1;
                final color = meta.$2;
                final timeAgo = _timeAgo(notif.createdAt);

                return _InnerRow(
                  onTap: () {
                    ref
                        .read(inboxNotificationsProvider.notifier)
                        .markRead(notif.id);
                    context.go(notif.route);
                  },
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
                            Text(notif.title,
                                style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                    color: _C.textPrimary),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis),
                            if (notif.body != null && notif.body!.isNotEmpty)
                              Text(notif.body!,
                                  style: const TextStyle(
                                      fontSize: 12, color: _C.textSecondary),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis),
                          ],
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(timeAgo,
                          style: const TextStyle(
                              fontSize: 11, color: _C.textTertiary)),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      },
    );
  }
}

// ── Leaderboard section ──────────────────────────────────────────────────────

class _LeaderboardSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncConfigs = ref.watch(leaderboardConfigsProvider);

    return asyncConfigs.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (configs) {
        if (configs.isEmpty) return const SizedBox.shrink();
        // Use the first leaderboard config.
        final config = configs.first;
        return _LeaderboardEntries(configId: config.id);
      },
    );
  }
}

class _LeaderboardEntries extends ConsumerWidget {
  final String configId;
  const _LeaderboardEntries({required this.configId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncEntries = ref.watch(leaderboardEntriesProvider(configId));
    final currentUserId =
        Supabase.instance.client.auth.currentUser?.id ?? '';

    return asyncEntries.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (entries) {
        if (entries.isEmpty) return const SizedBox.shrink();
        final top5 = entries.take(5).toList();

        return _SectionCard(
          label: 'LEADERBOARD',
          actionLabel: 'View full \u2192',
          route: '/badges',
          child: Column(
            children: top5.asMap().entries.map((e) {
              final idx = e.key;
              final entry = e.value;
              final rank = entry.rank > 0 ? entry.rank : idx + 1;
              final isMe = entry.userId == currentUserId;

              return _InnerRow(
                backgroundColor: isMe ? _C.sproutGreenLight : null,
                child: Row(
                  children: [
                    SizedBox(
                      width: 24,
                      child: Text(
                        '$rank',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: isMe ? _C.sproutGreen : _C.textSecondary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        entry.userName,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight:
                              isMe ? FontWeight.w600 : FontWeight.w400,
                          color: _C.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    Text(
                      '${entry.score.toInt()} pts',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: isMe ? _C.sproutGreen : _C.textSecondary,
                      ),
                    ),
                  ],
                ),
              );
            }).toList(),
          ),
        );
      },
    );
  }
}

// ── Announcements section ────────────────────────────────────────────────────

class _AnnouncementsSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncAnnouncements = ref.watch(announcementsProvider);

    return asyncAnnouncements.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (announcements) {
        if (announcements.isEmpty) return const SizedBox.shrink();
        final latest = announcements.take(3).toList();

        return _SectionCard(
          label: 'ANNOUNCEMENTS',
          actionLabel: 'View all \u2192',
          route: '/announcements',
          child: Column(
            children: latest.map((a) {
              final timeAgo = _timeAgo(a.createdAt);
              final preview = a.body.length > 80
                  ? '${a.body.substring(0, 80)}...'
                  : a.body;

              return _InnerRow(
                onTap: () {
                  ref.read(announcementsProvider.notifier).markRead(a.id);
                  context.go('/announcements');
                },
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: const Color(0xFF7C3AED).withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: const Icon(Icons.campaign,
                          size: 16, color: Color(0xFF7C3AED)),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(a.title,
                              style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                  color: _C.textPrimary),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis),
                          const SizedBox(height: 2),
                          Text(preview,
                              style: const TextStyle(
                                  fontSize: 12,
                                  color: _C.textSecondary,
                                  height: 1.3),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(timeAgo,
                        style: const TextStyle(
                            fontSize: 11, color: _C.textTertiary)),
                  ],
                ),
              );
            }).toList(),
          ),
        );
      },
    );
  }
}

// ── Buttons ──────────────────────────────────────────────────────────────────

class _PrimaryButton extends StatelessWidget {
  final String label;
  final bool isLoading;
  final VoidCallback onTap;
  const _PrimaryButton(
      {required this.label, this.isLoading = false, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isLoading ? null : onTap,
      child: Container(
        width: double.infinity,
        height: 50,
        decoration: BoxDecoration(
          color: _C.sproutGreen,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Center(
          child: isLoading
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : Text(label,
                  style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: Colors.white)),
        ),
      ),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  final String label;
  final VoidCallback onTap;
  const _SecondaryButton({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 50,
        decoration: BoxDecoration(
          color: _C.surface2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Center(
          child: Text(label,
              style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: _C.textPrimary)),
        ),
      ),
    );
  }
}

class _DestructiveButton extends StatelessWidget {
  final String label;
  final bool isLoading;
  final VoidCallback onTap;
  const _DestructiveButton(
      {required this.label, this.isLoading = false, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: isLoading ? null : onTap,
      child: Container(
        height: 50,
        decoration: BoxDecoration(
          color: _C.surface2,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Center(
          child: isLoading
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: _C.critical))
              : Text(label,
                  style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: _C.critical)),
        ),
      ),
    );
  }
}

// ── Sidekick sheet ───────────────────────────────────────────────────────────

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
                      style:
                          TextStyle(fontSize: 17, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
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
            Container(
              padding: EdgeInsets.only(
                left: 12,
                right: 8,
                top: 8,
                bottom: MediaQuery.of(context).padding.bottom + 8,
              ),
              decoration: const BoxDecoration(
                border: Border(top: BorderSide(color: _C.surface3)),
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
                        contentPadding:
                            EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send, color: _C.sproutGreen),
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

// ── Helpers ──────────────────────────────────────────────────────────────────

String _timeAgo(String isoDate) {
  final dt = DateTime.tryParse(isoDate);
  if (dt == null) return '';
  final diff = DateTime.now().difference(dt);
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  return DateFormat('MMM d').format(dt.toLocal());
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
            Container(
              width: 180,
              height: 24,
              decoration: BoxDecoration(
                color: _C.surface3,
                borderRadius: BorderRadius.circular(6),
              ),
            ),
            const SizedBox(height: 24),
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
              padding:
                  const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
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
