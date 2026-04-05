import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/auth/role_provider.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/shifts/data/models/shift_models.dart';
import 'package:frontline_app/features/shifts/providers/shifts_provider.dart';

class ShiftsScreen extends ConsumerWidget {
  const ShiftsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isManager = ref.watch(isManagerOrAboveProvider);

    final tabs = <Tab>[
      const Tab(text: 'My Shifts'),
      const Tab(text: 'Open Shifts'),
      if (isManager) const Tab(text: 'Approvals'),
      if (isManager) const Tab(text: 'Team'),
    ];

    final tabViews = <Widget>[
      const _MyShiftsTab(),
      const _OpenShiftsTab(),
      if (isManager) _ApprovalsInlineTab(),
      if (isManager) _TeamInlineTab(),
    ];

    return DefaultTabController(
      length: tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Shifts'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              tooltip: 'Refresh',
              onPressed: () =>
                  ref.read(myShiftsProvider.notifier).refresh(),
            ),
          ],
          bottom: TabBar(
            isScrollable: isManager,
            indicatorColor: SproutColors.green,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white60,
            tabs: tabs,
          ),
        ),
        body: TabBarView(children: tabViews),
      ),
    );
  }
}

// ── Approvals inline tab (lightweight, navigates to full screen) ──────────────

class _ApprovalsInlineTab extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.approval_outlined,
              size: 48, color: SproutColors.border),
          const SizedBox(height: 12),
          const Text('Workflow, swap, claim & leave approvals'),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () => context.go('/approvals'),
            child: const Text('Open Approvals'),
          ),
        ],
      ),
    );
  }
}

// ── Team inline tab (lightweight, navigates to full screen) ───────────────────

class _TeamInlineTab extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.people_outlined,
              size: 48, color: SproutColors.border),
          const SizedBox(height: 12),
          const Text("See who's on shift and clocked in today"),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () => context.go('/team'),
            child: const Text('Open Team View'),
          ),
        ],
      ),
    );
  }
}

// ── My Shifts tab ─────────────────────────────────────────────────────────────

class _MyShiftsTab extends ConsumerWidget {
  const _MyShiftsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncShifts = ref.watch(myShiftsProvider);

    return asyncShifts.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _ErrorBody(
        message: err.toString(),
        onRetry: () => ref.read(myShiftsProvider.notifier).refresh(),
      ),
      data: (shifts) {
        if (shifts.isEmpty) {
          return const _EmptyState(
            icon: Icons.calendar_today_outlined,
            title: 'No shifts scheduled',
            subtitle: 'Your upcoming shifts will appear here.',
          );
        }
        return RefreshIndicator(
          onRefresh: () => ref.read(myShiftsProvider.notifier).refresh(),
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: shifts.length,
            itemBuilder: (_, i) => _ShiftCard(shift: shifts[i]),
          ),
        );
      },
    );
  }
}

// ── Open Shifts tab ───────────────────────────────────────────────────────────

class _OpenShiftsTab extends ConsumerWidget {
  const _OpenShiftsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncOpen = ref.watch(openShiftsProvider);

    return asyncOpen.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _ErrorBody(
        message: err.toString(),
        onRetry: () => ref.invalidate(openShiftsProvider),
      ),
      data: (shifts) {
        if (shifts.isEmpty) {
          return const _EmptyState(
            icon: Icons.event_available_outlined,
            title: 'No open shifts',
            subtitle: 'Available shifts to pick up will appear here.',
          );
        }
        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(openShiftsProvider),
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: shifts.length,
            itemBuilder: (_, i) =>
                _OpenShiftCard(shift: shifts[i]),
          ),
        );
      },
    );
  }
}

// ── Shift card ────────────────────────────────────────────────────────────────

class _ShiftCard extends ConsumerWidget {
  final Shift shift;
  const _ShiftCard({required this.shift});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final start = DateTime.tryParse(shift.startAt)?.toLocal();
    final end = DateTime.tryParse(shift.endAt)?.toLocal();
    final now = DateTime.now();
    final isToday = start != null &&
        start.year == now.year &&
        start.month == now.month &&
        start.day == now.day;
    final isActive = start != null &&
        end != null &&
        now.isAfter(start) &&
        now.isBefore(end);

    final activeAttendance = ref.watch(activeAttendanceProvider).valueOrNull;
    final isClockedIn =
        activeAttendance != null && activeAttendance.shiftId == shift.id;

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 4,
                  height: 44,
                  decoration: BoxDecoration(
                    color: isActive
                        ? SproutColors.green
                        : isToday
                            ? SproutColors.cyan
                            : SproutColors.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (isToday)
                            Container(
                              margin: const EdgeInsets.only(right: 6),
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: SproutColors.green
                                    .withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(4),
                              ),
                              child: const Text('TODAY',
                                  style: TextStyle(
                                      color: SproutColors.green,
                                      fontSize: 10,
                                      fontWeight: FontWeight.w700)),
                            ),
                          Expanded(
                            child: Text(
                              _formatDate(start),
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${_formatTime(start)} – ${_formatTime(end)}',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ],
                  ),
                ),
                if (shift.locationName != null)
                  Chip(
                    label: Text(shift.locationName!,
                        style: const TextStyle(fontSize: 11)),
                    visualDensity: VisualDensity.compact,
                    padding: EdgeInsets.zero,
                  ),
              ],
            ),
            if (isToday || isActive || isClockedIn) ...[
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: isClockedIn
                    ? ElevatedButton.icon(
                        onPressed: () => _clockOut(context, ref),
                        icon: const Icon(Icons.logout, size: 18),
                        label: const Text('Clock Out'),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.orange.shade600,
                        ),
                      )
                    : ElevatedButton.icon(
                        onPressed: () => _clockIn(context, ref),
                        icon: const Icon(Icons.login, size: 18),
                        label: const Text('Clock In'),
                      ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _clockIn(BuildContext context, WidgetRef ref) async {
    if (shift.locationId == null || shift.locationId!.isEmpty) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Shift has no location — cannot clock in')),
        );
      }
      return;
    }
    try {
      final pos = await _getPosition();
      final repo = ref.read(shiftsRepositoryProvider);
      final record = await repo.clockIn(
        shiftId: shift.id,
        locationId: shift.locationId!,
        latitude: pos.latitude,
        longitude: pos.longitude,
      );
      ref.read(activeAttendanceProvider.notifier).set(record);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Clocked in'),
            backgroundColor: SproutColors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Clock-in failed: $e')),
        );
      }
    }
  }

  Future<void> _clockOut(BuildContext context, WidgetRef ref) async {
    final attendance = ref.read(activeAttendanceProvider).valueOrNull;
    if (attendance == null) return;
    try {
      final pos = await _getPosition();
      final repo = ref.read(shiftsRepositoryProvider);
      await repo.clockOut(
        attendanceId: attendance.id,
        latitude: pos.latitude,
        longitude: pos.longitude,
      );
      ref.read(activeAttendanceProvider.notifier).set(null);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Clocked out'),
            backgroundColor: SproutColors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Clock-out failed: $e')),
        );
      }
    }
  }

  Future<Position> _getPosition() async {
    LocationPermission perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) {
      perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied) {
        throw Exception('Location permission denied');
      }
    }
    if (perm == LocationPermission.deniedForever) {
      throw Exception(
          'Location permission permanently denied. Enable in Settings.');
    }
    return Geolocator.getCurrentPosition(
      locationSettings:
          const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }

  String _formatDate(DateTime? dt) {
    if (dt == null) return '—';
    return DateFormat('EEE, MMM d').format(dt);
  }

  String _formatTime(DateTime? dt) {
    if (dt == null) return '—';
    return DateFormat('h:mm a').format(dt);
  }
}

// ── Open shift card ───────────────────────────────────────────────────────────

class _OpenShiftCard extends ConsumerStatefulWidget {
  final Shift shift;
  const _OpenShiftCard({required this.shift});

  @override
  ConsumerState<_OpenShiftCard> createState() => _OpenShiftCardState();
}

class _OpenShiftCardState extends ConsumerState<_OpenShiftCard> {
  bool _claiming = false;
  String? _claimStatus;

  @override
  Widget build(BuildContext context) {
    final start = DateTime.tryParse(widget.shift.startAt)?.toLocal();
    final end = DateTime.tryParse(widget.shift.endAt)?.toLocal();

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          children: [
            Container(
              width: 4,
              height: 44,
              decoration: BoxDecoration(
                color: SproutColors.cyan,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_formatDate(start),
                      style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 2),
                  Text(
                    '${_formatTime(start)} – ${_formatTime(end)}',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  if (widget.shift.locationName != null) ...[
                    const SizedBox(height: 2),
                    Text(widget.shift.locationName!,
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                  if (widget.shift.role != null) ...[
                    const SizedBox(height: 2),
                    Text(widget.shift.role!,
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                ],
              ),
            ),
            if (_claimStatus == 'pending')
              const Chip(
                label: Text('Pending',
                    style: TextStyle(fontSize: 11, color: Colors.orange)),
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
              )
            else if (_claimStatus == 'approved')
              const Icon(Icons.check_circle, color: SproutColors.green)
            else
              _claiming
                  ? const SizedBox(
                      width: 24,
                      height: 24,
                      child:
                          CircularProgressIndicator(strokeWidth: 2))
                  : OutlinedButton(
                      onPressed: _claim,
                      style: OutlinedButton.styleFrom(
                        visualDensity: VisualDensity.compact,
                        side: const BorderSide(color: SproutColors.cyan),
                        foregroundColor: SproutColors.cyan,
                      ),
                      child: const Text('Claim'),
                    ),
          ],
        ),
      ),
    );
  }

  Future<void> _claim() async {
    setState(() => _claiming = true);
    try {
      final repo = ref.read(shiftsRepositoryProvider);
      final claim = await repo.claimShift(widget.shift.id);
      setState(() {
        _claiming = false;
        _claimStatus = claim.status;
      });
    } catch (e) {
      setState(() => _claiming = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Claim failed: $e')),
        );
      }
    }
  }

  String _formatDate(DateTime? dt) {
    if (dt == null) return '—';
    return DateFormat('EEE, MMM d').format(dt);
  }

  String _formatTime(DateTime? dt) {
    if (dt == null) return '—';
    return DateFormat('h:mm a').format(dt);
  }
}

// ── Shared widgets ────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  const _EmptyState(
      {required this.icon, required this.title, required this.subtitle});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 64, color: SproutColors.border),
          const SizedBox(height: 16),
          Text(title, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(subtitle,
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _ErrorBody extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorBody({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.wifi_off_outlined,
                size: 48, color: SproutColors.bodyText),
            const SizedBox(height: 16),
            Text('Could not load shifts',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(message,
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
                maxLines: 3,
                overflow: TextOverflow.ellipsis),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
