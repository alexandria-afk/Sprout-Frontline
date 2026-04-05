import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:dio/dio.dart';
import 'package:geolocator/geolocator.dart';
import 'package:frontline_app/core/api/dio_client.dart';
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
import 'package:frontline_app/features/badges/data/models/badge_models.dart';
import 'package:frontline_app/core/auth/role_provider.dart';
import 'package:frontline_app/features/dashboard/data/models/dashboard_summary.dart';
import 'dart:math' as math;

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
  final DashboardSummary summary;
  const _HomeBody({required this.summary});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncTasks = ref.watch(myTasksProvider);
    final asyncShifts = ref.watch(myShiftsProvider);
    final asyncEnrollments = ref.watch(myEnrollmentsProvider);
    final isManagerPlus = ref.watch(isManagerOrAboveProvider);

    final tasks = asyncTasks.valueOrNull ?? [];
    final enrollments = asyncEnrollments.valueOrNull ?? [];

    final overdueCount = tasks.where((t) => t.isOverdue).length;
    final openTaskCount = tasks
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
      final dt = DateTime.tryParse(s.startAt)?.toLocal();
      return dt != null && dt.isAfter(weekStart) && dt.isBefore(weekEnd);
    }).length;

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(dashboardSummaryProvider);
        ref.read(myTasksProvider.notifier).refresh();
        ref.read(myShiftsProvider.notifier).refresh();
        ref.invalidate(myEnrollmentsProvider);
        if (isManagerPlus) {
          ref.read(aiInsightsProvider.notifier).refresh();
        }
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
              openTaskCount: openTaskCount,
              incompleteCourses: incompleteCourses,
              shiftsThisWeek: shiftsThisWeek,
              totalTasks: tasks.length,
              totalEnrollments: enrollments.length,
            ),
          ),

          // 2. AI Insight cards (manager + admin only)
          if (ref.watch(isManagerOrAboveProvider))
            SliverToBoxAdapter(child: _AIInsightsSection()),

          // 2.5 Team Attendance (manager + admin only)
          if (isManagerPlus && summary.attendance != null)
            SliverToBoxAdapter(
              child: _TeamAttendanceSection(
                attendance: summary.attendance!,
                isAdmin: ref.watch(isAdminProvider),
              ),
            ),

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
  final int openTaskCount;
  final int incompleteCourses;
  final int shiftsThisWeek;
  final int totalTasks;
  final int totalEnrollments;

  const _MetricGrid({
    required this.overdueCount,
    required this.openTaskCount,
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
                  value: openTaskCount.toString(),
                  label: 'Open Tasks',
                  detail: openTaskCount == 0
                      ? 'All done'
                      : 'Needs attention',
                  color: openTaskCount > 0 ? _C.high : _C.positive,
                  onTap: () => context.go('/tasks'),
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
    return Semantics(
      label: '$value $label. $detail',
      button: true,
      child: GestureDetector(
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
                    behavior: HitTestBehavior.opaque,
                    child: SizedBox(
                      height: 44,
                      child: Padding(
                        padding: const EdgeInsets.only(left: 16),
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

// ── Team Attendance section ──────────────────────────────────────────────────

class _TeamAttendanceSection extends StatelessWidget {
  final AttendanceData attendance;
  final bool isAdmin;

  const _TeamAttendanceSection({
    required this.attendance,
    required this.isAdmin,
  });

  @override
  Widget build(BuildContext context) {
    return _SectionCard(
      label: isAdmin ? 'ATTENDANCE TODAY' : 'MY TEAM TODAY',
      child: Column(
        children: [
          // 3 rings row
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _AttendanceRing(
                value: attendance.presentRate,
                label: 'PRESENT',
                greenThreshold: 95,
                yellowThreshold: 85,
              ),
              _AttendanceRing(
                value: attendance.onTimeRate,
                label: 'ON TIME',
                greenThreshold: 90,
                yellowThreshold: 80,
              ),
              _AttendanceRing(
                value: attendance.utilizationRate,
                label: 'UTILIZATION',
                greenThreshold: 95,
                yellowThreshold: 85,
              ),
            ],
          ),
          // Admin: per-location table
          if (isAdmin && attendance.byLocation.isNotEmpty) ...[
            const SizedBox(height: 16),
            const Divider(height: 1, color: _C.surface3),
            const SizedBox(height: 12),
            ...attendance.byLocation.map(
              (loc) => _LocationRow(location: loc),
            ),
          ],
          // Manager: "Not clocked in" list
          if (!isAdmin) ...[
            ..._buildNotClockedInList(),
          ],
        ],
      ),
    );
  }

  List<Widget> _buildNotClockedInList() {
    final missing = <MissingStaff>[];
    for (final loc in attendance.byLocation) {
      missing.addAll(loc.notClockedIn);
    }
    if (missing.isEmpty) return [];
    return [
      const SizedBox(height: 16),
      const Divider(height: 1, color: _C.surface3),
      const SizedBox(height: 12),
      const Text(
        'Not clocked in',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: _C.textSecondary,
        ),
      ),
      const SizedBox(height: 8),
      ...missing.map(
        (m) => Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Row(
            children: [
              const Icon(Icons.person_outline,
                  size: 16, color: _C.textSecondary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  m.userName,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: _C.textPrimary,
                  ),
                ),
              ),
              Text(
                m.shiftStart,
                style: const TextStyle(
                  fontSize: 13,
                  color: _C.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ),
    ];
  }
}

class _LocationRow extends StatelessWidget {
  final LocationAttendance location;
  const _LocationRow({required this.location});

  @override
  Widget build(BuildContext context) {
    final rate = location.presentRate;
    final statusColor = rate >= 95
        ? _C.positive
        : rate >= 85
            ? _C.high
            : _C.critical;
    final statusNote = rate >= 95
        ? 'On track'
        : rate >= 85
            ? 'Needs attention'
            : 'Below target';

    return GestureDetector(
      onTap: () => context.go('/shifts'),
      child: Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: [
            Expanded(
              flex: 3,
              child: Text(
                location.locationName,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: _C.textPrimary,
                ),
              ),
            ),
            Expanded(
              flex: 2,
              child: Text(
                '${location.clockedIn}/${location.scheduled}',
                style: const TextStyle(
                  fontSize: 13,
                  color: _C.textSecondary,
                ),
              ),
            ),
            Expanded(
              flex: 1,
              child: Text(
                '$rate%',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: statusColor,
                ),
              ),
            ),
            Expanded(
              flex: 2,
              child: Text(
                statusNote,
                textAlign: TextAlign.end,
                style: TextStyle(
                  fontSize: 12,
                  color: statusColor,
                ),
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.chevron_right, size: 16, color: _C.textTertiary),
          ],
        ),
      ),
    );
  }
}

class _AttendanceRing extends StatefulWidget {
  final int value;
  final String label;
  final int greenThreshold;
  final int yellowThreshold;

  const _AttendanceRing({
    required this.value,
    required this.label,
    required this.greenThreshold,
    required this.yellowThreshold,
  });

  @override
  State<_AttendanceRing> createState() => _AttendanceRingState();
}

class _AttendanceRingState extends State<_AttendanceRing>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  late final Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _animation = Tween<double>(begin: 0, end: widget.value / 100.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOut),
    );
    _controller.forward();
  }

  @override
  void didUpdateWidget(covariant _AttendanceRing oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.value != widget.value) {
      _animation = Tween<double>(
        begin: _animation.value,
        end: widget.value / 100.0,
      ).animate(
        CurvedAnimation(parent: _controller, curve: Curves.easeOut),
      );
      _controller
        ..reset()
        ..forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Color get _ringColor {
    final v = widget.value;
    if (v >= widget.greenThreshold) return _C.positive;
    if (v >= widget.yellowThreshold) return _C.high;
    return _C.critical;
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _animation,
      builder: (context, child) {
        return Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 80,
              height: 80,
              child: CustomPaint(
                painter: _RingPainter(
                  progress: _animation.value,
                  color: _ringColor,
                  backgroundColor: _C.surface3,
                  strokeWidth: 6,
                ),
                child: Center(
                  child: Text(
                    '${(_animation.value * 100).round()}%',
                    style: const TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.bold,
                      color: _C.textPrimary,
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 6),
            Text(
              widget.label,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: _C.textSecondary,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _RingPainter extends CustomPainter {
  final double progress;
  final Color color;
  final Color backgroundColor;
  final double strokeWidth;

  _RingPainter({
    required this.progress,
    required this.color,
    required this.backgroundColor,
    required this.strokeWidth,
  });

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = (math.min(size.width, size.height) - strokeWidth) / 2;

    // Background ring
    final bgPaint = Paint()
      ..color = backgroundColor
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;
    canvas.drawCircle(center, radius, bgPaint);

    // Progress ring
    final fgPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = strokeWidth
      ..strokeCap = StrokeCap.round;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: radius),
      -math.pi / 2, // start at top
      2 * math.pi * progress,
      false,
      fgPaint,
    );
  }

  @override
  bool shouldRepaint(covariant _RingPainter oldDelegate) =>
      oldDelegate.progress != progress ||
      oldDelegate.color != color;
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
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: _C.surface1,
        borderRadius: BorderRadius.circular(12),
        border: Border(left: BorderSide(color: accentColor, width: 3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(icon, style: const TextStyle(fontSize: 14)),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(insight.title,
                    style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: _C.textPrimary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
                const SizedBox(height: 2),
                Text(insight.recommendation,
                    style: TextStyle(
                        fontSize: 12,
                        color: accentColor),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ],
            ),
          ),
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
    final activeAttendance = ref.watch(activeAttendanceProvider).valueOrNull;

    // Find active shift (clocked in or currently in progress) or next upcoming.
    final upcoming = widget.shifts.where((s) {
      final end = DateTime.tryParse(s.endAt);
      // Keep shifts that haven't ended yet.
      return end != null && end.isAfter(now);
    }).toList()
      ..sort((a, b) {
        final aStart = DateTime.tryParse(a.startAt) ?? now;
        final bStart = DateTime.tryParse(b.startAt) ?? now;
        return aStart.compareTo(bStart);
      });

    // No upcoming shift.
    if (upcoming.isEmpty) {
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

    final shift = upcoming.first;
    final start = DateTime.tryParse(shift.startAt)?.toLocal();
    final end = DateTime.tryParse(shift.endAt)?.toLocal();
    final isClockedIn = activeAttendance != null;
    final isActive = start != null && end != null &&
        now.isAfter(start) && now.isBefore(end);

    // Build subtitle: clocked in > active > location + date
    String subtitle;
    if (isClockedIn) {
      subtitle = 'Clocked in at ${DateFormat('h:mm a').format(DateTime.tryParse(activeAttendance.clockInAt)?.toLocal() ?? now)}';
    } else if (start != null) {
      final isToday = start.year == now.year &&
          start.month == now.month && start.day == now.day;
      final loc = shift.locationName ?? '';
      if (isToday) {
        subtitle = loc.isNotEmpty ? loc : 'Today';
      } else {
        final dateStr = DateFormat('EEE, MMM d').format(start);
        subtitle = loc.isNotEmpty ? '$loc · $dateStr' : dateStr;
      }
    } else {
      subtitle = shift.locationName ?? 'Upcoming';
    }

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
                    color: (isClockedIn || isActive)
                        ? _C.sproutGreenLight
                        : _C.surface3,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(
                    (isClockedIn || isActive) ? Icons.timer : Icons.schedule,
                    color: (isClockedIn || isActive)
                        ? _C.sproutGreen
                        : _C.textSecondary,
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
                        subtitle,
                        style: const TextStyle(
                            fontSize: 13, color: _C.textSecondary),
                      ),
                    ],
                  ),
                ),
                if (isClockedIn || isActive)
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
      ref.read(activeAttendanceProvider.notifier).set(attendance);
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
      ref.read(activeAttendanceProvider.notifier).set(null);
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
        final userInTop5 =
            top5.any((e) => e.userId == currentUserId);

        // Find user's entry if not in top 5.
        LeaderboardEntry? userEntry;
        int? userRank;
        if (!userInTop5) {
          for (var i = 0; i < entries.length; i++) {
            if (entries[i].userId == currentUserId) {
              userEntry = entries[i];
              userRank = entries[i].rank > 0 ? entries[i].rank : i + 1;
              break;
            }
          }
        }

        return _SectionCard(
          label: 'LEADERBOARD',
          actionLabel: 'View full \u2192',
          route: '/badges',
          child: Column(
            children: [
              // Top 5 rows
              ...top5.asMap().entries.map((e) {
                final idx = e.key;
                final entry = e.value;
                final rank = entry.rank > 0 ? entry.rank : idx + 1;
                final isMe = entry.userId == currentUserId;
                return _leaderboardRow(entry, rank, isMe);
              }),
              // If user is outside top 5, show separator + their row
              if (userEntry != null) ...[
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(
                    children: [
                      const Expanded(child: Divider(color: _C.surface3)),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Text('You',
                            style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: _C.sproutGreen)),
                      ),
                      const Expanded(child: Divider(color: _C.surface3)),
                    ],
                  ),
                ),
                _leaderboardRow(userEntry, userRank!, true),
              ],
            ],
          ),
        );
      },
    );
  }

  Widget _leaderboardRow(LeaderboardEntry entry, int rank, bool isMe) {
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
                fontWeight: isMe ? FontWeight.w600 : FontWeight.w400,
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
              final preview = a.body.characters.length > 80
                  ? '${a.body.characters.take(80)}...'
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

// ── Sidekick sheet (AI chat) ─────────────────────────────────────────────────

class _ChatMessage {
  final String role; // 'user' or 'assistant'
  final String content;
  const _ChatMessage({required this.role, required this.content});
  Map<String, dynamic> toJson() => {'role': role, 'content': content};
}

class _SidekickSheet extends StatefulWidget {
  @override
  State<_SidekickSheet> createState() => _SidekickSheetState();
}

class _SidekickSheetState extends State<_SidekickSheet> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final List<_ChatMessage> _messages = [];
  bool _isSending = false;

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _isSending) return;
    _controller.clear();

    setState(() {
      _messages.add(_ChatMessage(role: 'user', content: text));
      _isSending = true;
    });
    _scrollToBottom();

    try {
      final response = await DioClient.instance.post(
        '/api/v1/ai/chat',
        data: {
          'messages': _messages.map((m) => m.toJson()).toList(),
        },
        options: Options(receiveTimeout: const Duration(seconds: 60)),
      );
      final data = response.data;
      final reply = data is Map
          ? (data['reply'] as String?) ?? 'No response'
          : 'No response';
      setState(() {
        _messages.add(_ChatMessage(role: 'assistant', content: reply));
      });
    } catch (_) {
      setState(() {
        _messages.add(const _ChatMessage(
            role: 'assistant',
            content: 'Sorry, I couldn\'t process that. Please try again.'));
      });
    } finally {
      setState(() => _isSending = false);
      _scrollToBottom();
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _useSuggestion(String text) {
    _controller.text = text;
    _send();
  }

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.55,
      maxChildSize: 0.85,
      minChildSize: 0.3,
      builder: (_, sheetScrollCtrl) => Container(
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
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
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
                  const Spacer(),
                  if (_messages.isNotEmpty)
                    GestureDetector(
                      onTap: () => setState(() => _messages.clear()),
                      child: const Text('Reset',
                          style: TextStyle(
                              fontSize: 13, color: _C.textSecondary)),
                    ),
                ],
              ),
            ),
            // Suggestion chips (only when no messages yet)
            if (_messages.isEmpty)
              SizedBox(
                height: 36,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    _SuggestionChip(
                      label: "What's overdue?",
                      onTap: () => _useSuggestion("What's overdue?"),
                    ),
                    _SuggestionChip(
                      label: 'Summarize my day',
                      onTap: () => _useSuggestion('Summarize my day'),
                    ),
                    _SuggestionChip(
                      label: "Who's on shift?",
                      onTap: () => _useSuggestion("Who's on shift?"),
                    ),
                  ],
                ),
              ),
            // Chat messages
            Expanded(
              child: _messages.isEmpty
                  ? const Center(
                      child: Text('Ask me anything about your work',
                          style: TextStyle(
                              fontSize: 14, color: _C.textSecondary)))
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.all(16),
                      itemCount: _messages.length + (_isSending ? 1 : 0),
                      itemBuilder: (_, i) {
                        if (i == _messages.length) {
                          // Typing indicator
                          return const Align(
                            alignment: Alignment.centerLeft,
                            child: Padding(
                              padding: EdgeInsets.only(top: 8),
                              child: SizedBox(
                                width: 24,
                                height: 24,
                                child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                    color: Color(0xFF7C3AED)),
                              ),
                            ),
                          );
                        }
                        final msg = _messages[i];
                        final isUser = msg.role == 'user';
                        return Align(
                          alignment: isUser
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.only(bottom: 8),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 14, vertical: 10),
                            constraints: BoxConstraints(
                              maxWidth:
                                  MediaQuery.of(context).size.width * 0.75,
                            ),
                            decoration: BoxDecoration(
                              color: isUser
                                  ? _C.sproutGreen
                                  : _C.surface2,
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Text(
                              msg.content,
                              style: TextStyle(
                                fontSize: 14,
                                color: isUser
                                    ? Colors.white
                                    : _C.textPrimary,
                                height: 1.4,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
            // Input bar
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
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _send(),
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
                    icon: Icon(Icons.send,
                        color:
                            _isSending ? _C.textTertiary : _C.sproutGreen),
                    onPressed: _isSending ? null : _send,
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
  final dt = DateTime.tryParse(isoDate)?.toLocal();
  if (dt == null) return '';
  final diff = DateTime.now().difference(dt);
  if (diff.isNegative) return '';
  if (diff.inMinutes < 1) return 'now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m';
  if (diff.inHours < 24) return '${diff.inHours}h';
  if (diff.inDays < 7) return '${diff.inDays}d';
  return DateFormat('MMM d').format(dt);
}

// ── Skeleton loading ──────────────────────────────────────────────────────────

class _SkeletonHome extends StatefulWidget {
  const _SkeletonHome();

  @override
  State<_SkeletonHome> createState() => _SkeletonHomeState();
}

class _SkeletonHomeState extends State<_SkeletonHome>
    with SingleTickerProviderStateMixin {
  late final AnimationController _shimmer;

  @override
  void initState() {
    super.initState();
    _shimmer = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _shimmer,
      builder: (_, __) {
        final opacity = 0.3 + 0.3 * (0.5 + 0.5 * (_shimmer.value * 2 - 1).abs());
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Opacity(
                  opacity: opacity,
                  child: Container(
                    width: 180,
                    height: 24,
                    decoration: BoxDecoration(
                      color: _C.surface3,
                      borderRadius: BorderRadius.circular(6),
                    ),
                  ),
                ),
                const SizedBox(height: 24),
                Row(
                  children: List.generate(
                    2,
                    (_) => Expanded(
                      child: Opacity(
                        opacity: opacity,
                        child: Container(
                          height: 90,
                          margin: const EdgeInsets.only(right: 12),
                          decoration: BoxDecoration(
                            color: _C.surface1,
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: List.generate(
                    2,
                    (_) => Expanded(
                      child: Opacity(
                        opacity: opacity,
                        child: Container(
                          height: 90,
                          margin: const EdgeInsets.only(right: 12),
                          decoration: BoxDecoration(
                            color: _C.surface1,
                            borderRadius: BorderRadius.circular(16),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                ...List.generate(
                  2,
                  (_) => Opacity(
                    opacity: opacity,
                    child: Container(
                      width: double.infinity,
                      height: 100,
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: _C.surface1,
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
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
