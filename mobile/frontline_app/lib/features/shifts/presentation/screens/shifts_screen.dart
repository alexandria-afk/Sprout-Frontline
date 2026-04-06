import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
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
      const Tab(text: 'Swaps'),
      const Tab(text: 'Leave'),
      if (isManager) const Tab(text: 'Approvals'),
      if (isManager) const Tab(text: 'Team'),
    ];

    final tabViews = <Widget>[
      const _MyShiftsTab(),
      const _OpenShiftsTab(),
      const _SwapsTab(),
      const _LeaveTab(),
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
            isScrollable: true,
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

// ── Swaps tab ────────────────────────────────────────────────────────────────

class _SwapsTab extends ConsumerWidget {
  const _SwapsTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncSwaps = ref.watch(swapRequestsProvider);

    return asyncSwaps.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _ErrorBody(
        message: err.toString(),
        onRetry: () => ref.read(swapRequestsProvider.notifier).refresh(),
      ),
      data: (swaps) {
        if (swaps.isEmpty) {
          return Stack(
            children: [
              const _EmptyState(
                icon: Icons.swap_horiz_outlined,
                title: 'No swap requests',
                subtitle: 'Your shift swap requests will appear here.',
              ),
              Positioned(
                bottom: 24,
                right: 24,
                child: FloatingActionButton.extended(
                  heroTag: 'swap_fab',
                  onPressed: () => _showRequestSwapSheet(context, ref),
                  icon: const Icon(Icons.swap_horiz),
                  label: const Text('Request Swap'),
                  backgroundColor: SproutColors.green,
                ),
              ),
            ],
          );
        }
        return Stack(
          children: [
            RefreshIndicator(
              onRefresh: () =>
                  ref.read(swapRequestsProvider.notifier).refresh(),
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 80),
                itemCount: swaps.length,
                itemBuilder: (_, i) => _SwapCard(swap: swaps[i]),
              ),
            ),
            Positioned(
              bottom: 24,
              right: 24,
              child: FloatingActionButton.extended(
                heroTag: 'swap_fab',
                onPressed: () => _showRequestSwapSheet(context, ref),
                icon: const Icon(Icons.swap_horiz),
                label: const Text('Request Swap'),
                backgroundColor: SproutColors.green,
              ),
            ),
          ],
        );
      },
    );
  }

  void _showRequestSwapSheet(BuildContext context, WidgetRef ref) {
    final asyncShifts = ref.read(myShiftsProvider);
    final shifts = asyncShifts.valueOrNull ?? [];
    // Filter to upcoming shifts only.
    final now = DateTime.now();
    final upcoming = shifts.where((s) {
      final start = DateTime.tryParse(s.startAt);
      return start != null && start.isAfter(now);
    }).toList();

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.5,
        minChildSize: 0.3,
        maxChildSize: 0.8,
        builder: (_, controller) => Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: SproutColors.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Text('Select a shift to swap',
                  style: Theme.of(ctx).textTheme.titleMedium),
              const SizedBox(height: 12),
              if (upcoming.isEmpty)
                const Expanded(
                  child: Center(
                    child: Text('No upcoming shifts available to swap.'),
                  ),
                )
              else
                Expanded(
                  child: ListView.builder(
                    controller: controller,
                    itemCount: upcoming.length,
                    itemBuilder: (_, i) {
                      final s = upcoming[i];
                      final start = DateTime.tryParse(s.startAt)?.toLocal();
                      final end = DateTime.tryParse(s.endAt)?.toLocal();
                      return Card(
                        margin: const EdgeInsets.only(bottom: 8),
                        child: ListTile(
                          leading: const Icon(Icons.calendar_today,
                              color: SproutColors.cyan),
                          title: Text(
                            start != null
                                ? DateFormat('EEE, MMM d').format(start)
                                : '---',
                          ),
                          subtitle: Text(
                            '${start != null ? DateFormat('h:mm a').format(start) : '--'}'
                            ' - ${end != null ? DateFormat('h:mm a').format(end) : '--'}'
                            '${s.locationName != null ? '  |  ${s.locationName}' : ''}',
                          ),
                          onTap: () async {
                            Navigator.of(ctx).pop();
                            await _submitSwap(context, ref, s.id);
                          },
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _submitSwap(
      BuildContext context, WidgetRef ref, String shiftId) async {
    try {
      final repo = ref.read(shiftsRepositoryProvider);
      await repo.createSwapRequest(shiftId: shiftId);
      ref.read(swapRequestsProvider.notifier).refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Swap request created'),
            backgroundColor: SproutColors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to create swap: $e')),
        );
      }
    }
  }
}

class _SwapCard extends ConsumerWidget {
  final ShiftSwapRequest swap;
  const _SwapCard({required this.swap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentUserId =
        Supabase.instance.client.auth.currentUser?.id ?? '';
    final isIncoming = swap.targetUserId == currentUserId &&
        swap.status == 'pending_peer';

    final start = swap.shiftStartAt != null
        ? DateTime.tryParse(swap.shiftStartAt!)
        : null;
    final end = swap.shiftEndAt != null
        ? DateTime.tryParse(swap.shiftEndAt!)
        : null;

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
                    color: _swapStatusColor(swap.status),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        start != null
                            ? DateFormat('EEE, MMM d').format(start)
                            : 'Shift date unknown',
                        style: Theme.of(context).textTheme.titleSmall,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${start != null ? DateFormat('h:mm a').format(start) : '--'}'
                        ' - ${end != null ? DateFormat('h:mm a').format(end) : '--'}',
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      if (swap.locationName != null) ...[
                        const SizedBox(height: 2),
                        Text(swap.locationName!,
                            style: Theme.of(context).textTheme.bodySmall),
                      ],
                      if (isIncoming && swap.requesterName != null) ...[
                        const SizedBox(height: 2),
                        Text('From: ${swap.requesterName}',
                            style: Theme.of(context)
                                .textTheme
                                .bodySmall
                                ?.copyWith(
                                    color: SproutColors.green,
                                    fontWeight: FontWeight.w600)),
                      ] else if (swap.targetUserName != null) ...[
                        const SizedBox(height: 2),
                        Text('Swap with: ${swap.targetUserName}',
                            style: Theme.of(context).textTheme.bodySmall),
                      ],
                    ],
                  ),
                ),
                _SwapStatusBadge(status: swap.status),
              ],
            ),
            // Accept / Decline buttons for incoming swaps
            if (isIncoming) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _respond(context, ref, 'decline'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.red,
                        side: const BorderSide(color: Colors.red),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text('Decline'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () => _respond(context, ref, 'accept'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: SproutColors.green,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8)),
                      ),
                      child: const Text('Accept'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _respond(
      BuildContext context, WidgetRef ref, String action) async {
    try {
      final repo = ref.read(shiftsRepositoryProvider);
      await repo.respondToSwapAsColleague(swapId: swap.id, action: action);
      ref.read(swapRequestsProvider.notifier).refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
              content: Text(action == 'accept'
                  ? 'Swap accepted — awaiting manager approval'
                  : 'Swap declined')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e')),
        );
      }
    }
  }

  Color _swapStatusColor(String status) {
    switch (status) {
      case 'approved':
        return SproutColors.green;
      case 'rejected':
        return Colors.red;
      case 'cancelled':
        return Colors.grey;
      default:
        return Colors.amber;
    }
  }
}

class _SwapStatusBadge extends StatelessWidget {
  final String status;
  const _SwapStatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final Color bg;
    final Color fg;
    final String label;

    switch (status) {
      case 'approved':
        bg = SproutColors.green.withValues(alpha: 0.12);
        fg = SproutColors.green;
        label = 'Approved';
      case 'rejected':
        bg = Colors.red.withValues(alpha: 0.12);
        fg = Colors.red;
        label = 'Rejected';
      case 'cancelled':
        bg = Colors.grey.withValues(alpha: 0.12);
        fg = Colors.grey;
        label = 'Cancelled';
      case 'pending_manager':
        bg = Colors.amber.withValues(alpha: 0.12);
        fg = Colors.amber.shade800;
        label = 'Mgr Review';
      default:
        bg = Colors.amber.withValues(alpha: 0.12);
        fg = Colors.amber.shade800;
        label = 'Pending';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style:
              TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

// ── Leave tab ────────────────────────────────────────────────────────────────

class _LeaveTab extends ConsumerWidget {
  const _LeaveTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncLeave = ref.watch(leaveRequestsProvider);

    return asyncLeave.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => _ErrorBody(
        message: err.toString(),
        onRetry: () => ref.read(leaveRequestsProvider.notifier).refresh(),
      ),
      data: (requests) {
        if (requests.isEmpty) {
          return Stack(
            children: [
              const _EmptyState(
                icon: Icons.beach_access_outlined,
                title: 'No leave requests',
                subtitle: 'Your leave requests will appear here.',
              ),
              Positioned(
                bottom: 24,
                right: 24,
                child: FloatingActionButton.extended(
                  heroTag: 'leave_fab',
                  onPressed: () => _showRequestLeaveSheet(context, ref),
                  icon: const Icon(Icons.add),
                  label: const Text('Request Leave'),
                  backgroundColor: SproutColors.green,
                ),
              ),
            ],
          );
        }
        return Stack(
          children: [
            RefreshIndicator(
              onRefresh: () =>
                  ref.read(leaveRequestsProvider.notifier).refresh(),
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 80),
                itemCount: requests.length,
                itemBuilder: (_, i) => _LeaveCard(leave: requests[i]),
              ),
            ),
            Positioned(
              bottom: 24,
              right: 24,
              child: FloatingActionButton.extended(
                heroTag: 'leave_fab',
                onPressed: () => _showRequestLeaveSheet(context, ref),
                icon: const Icon(Icons.add),
                label: const Text('Request Leave'),
                backgroundColor: SproutColors.green,
              ),
            ),
          ],
        );
      },
    );
  }

  void _showRequestLeaveSheet(BuildContext context, WidgetRef ref) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.only(
          bottom: MediaQuery.of(ctx).viewInsets.bottom,
        ),
        child: _LeaveRequestForm(
          onSubmit: (leaveType, startDate, endDate, reason) async {
            Navigator.of(ctx).pop();
            await _submitLeave(
                context, ref, leaveType, startDate, endDate, reason);
          },
        ),
      ),
    );
  }

  Future<void> _submitLeave(
    BuildContext context,
    WidgetRef ref,
    String leaveType,
    String startDate,
    String endDate,
    String? reason,
  ) async {
    try {
      final repo = ref.read(shiftsRepositoryProvider);
      await repo.createLeaveRequest(
        leaveType: leaveType,
        startDate: startDate,
        endDate: endDate,
        reason: reason,
      );
      ref.read(leaveRequestsProvider.notifier).refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Leave request submitted'),
            backgroundColor: SproutColors.green,
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to request leave: $e')),
        );
      }
    }
  }
}

class _LeaveCard extends StatelessWidget {
  final LeaveRequest leave;
  const _LeaveCard({required this.leave});

  @override
  Widget build(BuildContext context) {
    final startDt = DateTime.tryParse(leave.startDate);
    final endDt = DateTime.tryParse(leave.endDate);

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
                color: _leaveStatusColor(leave.status),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _capitalise(leave.leaveType),
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${startDt != null ? DateFormat('MMM d').format(startDt) : '--'}'
                    ' - ${endDt != null ? DateFormat('MMM d, y').format(endDt) : '--'}',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                  if (leave.reason != null && leave.reason!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(leave.reason!,
                        style: Theme.of(context).textTheme.bodySmall,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis),
                  ],
                ],
              ),
            ),
            _LeaveStatusBadge(status: leave.status),
          ],
        ),
      ),
    );
  }

  String _capitalise(String s) {
    if (s.isEmpty) return s;
    return s[0].toUpperCase() + s.substring(1);
  }

  Color _leaveStatusColor(String status) {
    switch (status) {
      case 'approved':
        return SproutColors.green;
      case 'rejected':
        return Colors.red;
      default:
        return Colors.amber;
    }
  }
}

class _LeaveStatusBadge extends StatelessWidget {
  final String status;
  const _LeaveStatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final Color bg;
    final Color fg;
    final String label;

    switch (status) {
      case 'approved':
        bg = SproutColors.green.withValues(alpha: 0.12);
        fg = SproutColors.green;
        label = 'Approved';
      case 'rejected':
        bg = Colors.red.withValues(alpha: 0.12);
        fg = Colors.red;
        label = 'Rejected';
      default:
        bg = Colors.amber.withValues(alpha: 0.12);
        fg = Colors.amber.shade800;
        label = 'Pending';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style:
              TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w600)),
    );
  }
}

class _LeaveRequestForm extends StatefulWidget {
  final Future<void> Function(
      String leaveType, String startDate, String endDate, String? reason)
      onSubmit;
  const _LeaveRequestForm({required this.onSubmit});

  @override
  State<_LeaveRequestForm> createState() => _LeaveRequestFormState();
}

class _LeaveRequestFormState extends State<_LeaveRequestForm> {
  static const _leaveTypes = ['annual', 'sick', 'emergency', 'unpaid', 'other'];

  String _selectedType = 'annual';
  DateTime? _startDate;
  DateTime? _endDate;
  final _reasonController = TextEditingController();
  bool _submitting = false;

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(24, 16, 24, 24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: SproutColors.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          Text('Request Leave',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          // Leave type
          DropdownButtonFormField<String>(
            initialValue: _selectedType,
            decoration: const InputDecoration(
              labelText: 'Leave Type',
              border: OutlineInputBorder(),
            ),
            items: _leaveTypes
                .map((t) => DropdownMenuItem(
                      value: t,
                      child: Text(t[0].toUpperCase() + t.substring(1)),
                    ))
                .toList(),
            onChanged: (v) {
              if (v != null) setState(() => _selectedType = v);
            },
          ),
          const SizedBox(height: 16),
          // Start date
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.calendar_today),
            title: Text(_startDate != null
                ? DateFormat('EEE, MMM d, y').format(_startDate!)
                : 'Select start date'),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _startDate ?? DateTime.now(),
                firstDate: DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (picked != null) setState(() => _startDate = picked);
            },
          ),
          // End date
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.calendar_today),
            title: Text(_endDate != null
                ? DateFormat('EEE, MMM d, y').format(_endDate!)
                : 'Select end date'),
            onTap: () async {
              final picked = await showDatePicker(
                context: context,
                initialDate: _endDate ?? _startDate ?? DateTime.now(),
                firstDate: _startDate ?? DateTime.now(),
                lastDate: DateTime.now().add(const Duration(days: 365)),
              );
              if (picked != null) setState(() => _endDate = picked);
            },
          ),
          const SizedBox(height: 8),
          // Reason
          TextField(
            controller: _reasonController,
            decoration: const InputDecoration(
              labelText: 'Reason (optional)',
              border: OutlineInputBorder(),
            ),
            maxLines: 2,
          ),
          const SizedBox(height: 20),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _canSubmit && !_submitting
                  ? () async {
                      setState(() => _submitting = true);
                      await widget.onSubmit(
                        _selectedType,
                        _startDate!.toIso8601String().substring(0, 10),
                        _endDate!.toIso8601String().substring(0, 10),
                        _reasonController.text.trim().isEmpty
                            ? null
                            : _reasonController.text.trim(),
                      );
                    }
                  : null,
              child: _submitting
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Text('Submit'),
            ),
          ),
        ],
      ),
    );
  }

  bool get _canSubmit => _startDate != null && _endDate != null;
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
