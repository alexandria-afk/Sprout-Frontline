import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/team/providers/team_provider.dart';

class TeamScreen extends ConsumerWidget {
  const TeamScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncTeam = ref.watch(teamDataProvider);

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Team Today'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () => ref.invalidate(teamDataProvider),
            ),
          ],
          bottom: const TabBar(
            indicatorColor: SproutColors.green,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white60,
            tabs: [
              Tab(text: 'On Shift'),
              Tab(text: 'Clocked In'),
            ],
          ),
        ),
        body: asyncTeam.when(
          loading: () =>
              const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('Could not load team data',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () => ref.invalidate(teamDataProvider),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
          data: (data) => TabBarView(
            children: [
              _ShiftTab(shifts: data.shifts),
              _AttendanceTab(records: data.attendance),
            ],
          ),
        ),
      ),
    );
  }
}

// ── On Shift tab ──────────────────────────────────────────────────────────────

class _ShiftTab extends StatelessWidget {
  final List<Map<String, dynamic>> shifts;
  const _ShiftTab({required this.shifts});

  @override
  Widget build(BuildContext context) {
    if (shifts.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.event_busy, size: 48, color: SproutColors.border),
            SizedBox(height: 12),
            Text('No one scheduled today'),
          ],
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: shifts.length,
      itemBuilder: (_, i) => _ShiftRow(shift: shifts[i]),
    );
  }
}

class _ShiftRow extends StatelessWidget {
  final Map<String, dynamic> shift;
  const _ShiftRow({required this.shift});

  @override
  Widget build(BuildContext context) {
    final profile = shift['profiles'] as Map? ??
        shift['assigned_user'] as Map? ??
        {};
    final name = profile['full_name'] as String? ?? 'Unassigned';
    final role = shift['role'] as String?;
    final start = DateTime.tryParse(shift['start_at'] as String? ?? '')?.toLocal();
    final end = DateTime.tryParse(shift['end_at'] as String? ?? '')?.toLocal();
    final timeStr = start != null && end != null
        ? '${DateFormat('h:mm a').format(start)} – ${DateFormat('h:mm a').format(end)}'
        : '';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: SproutColors.green.withValues(alpha: 0.12),
          child: Text(
            name.isNotEmpty ? name[0].toUpperCase() : '?',
            style: const TextStyle(
                color: SproutColors.green, fontWeight: FontWeight.w600),
          ),
        ),
        title: Text(name,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
          [if (role != null) role, timeStr]
              .where((s) => s.isNotEmpty)
              .join(' · '),
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ),
    );
  }
}

// ── Clocked In tab ────────────────────────────────────────────────────────────

class _AttendanceTab extends StatelessWidget {
  final List<Map<String, dynamic>> records;
  const _AttendanceTab({required this.records});

  @override
  Widget build(BuildContext context) {
    final active =
        records.where((a) => a['clock_out_at'] == null).toList();
    final done =
        records.where((a) => a['clock_out_at'] != null).toList();

    if (records.isEmpty) {
      return const Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.person_off, size: 48, color: SproutColors.border),
            SizedBox(height: 12),
            Text('No one has clocked in today'),
          ],
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (active.isNotEmpty) ...[
          _sectionLabel(context, 'CURRENTLY CLOCKED IN (${active.length})'),
          const SizedBox(height: 8),
          ...active.map((a) => _AttendanceRow(record: a, active: true)),
        ],
        if (done.isNotEmpty) ...[
          const SizedBox(height: 16),
          _sectionLabel(context, 'CLOCKED OUT (${done.length})'),
          const SizedBox(height: 8),
          ...done.map((a) => _AttendanceRow(record: a, active: false)),
        ],
      ],
    );
  }

  Widget _sectionLabel(BuildContext context, String text) {
    return Text(text,
        style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: SproutColors.bodyText,
            letterSpacing: 0.5));
  }
}

class _AttendanceRow extends StatelessWidget {
  final Map<String, dynamic> record;
  final bool active;
  const _AttendanceRow({required this.record, required this.active});

  @override
  Widget build(BuildContext context) {
    final profile = record['profiles'] as Map? ?? {};
    final name = profile['full_name'] as String? ?? 'Unknown';
    final clockIn =
        DateTime.tryParse(record['clock_in_at'] as String? ?? '')?.toLocal();
    final clockOut =
        DateTime.tryParse(record['clock_out_at'] as String? ?? '')?.toLocal();

    final timeStr = clockIn != null
        ? 'In: ${DateFormat('h:mm a').format(clockIn)}${clockOut != null ? ' · Out: ${DateFormat('h:mm a').format(clockOut)}' : ''}'
        : '';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: active
              ? SproutColors.green.withValues(alpha: 0.12)
              : SproutColors.border.withValues(alpha: 0.3),
          child: Text(
            name.isNotEmpty ? name[0].toUpperCase() : '?',
            style: TextStyle(
                color: active ? SproutColors.green : SproutColors.bodyText,
                fontWeight: FontWeight.w600),
          ),
        ),
        title: Text(name,
            style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(timeStr,
            style: Theme.of(context).textTheme.bodySmall),
        trailing: active
            ? Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: SproutColors.green.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: const Text('ACTIVE',
                    style: TextStyle(
                        color: SproutColors.green,
                        fontSize: 10,
                        fontWeight: FontWeight.w700)),
              )
            : null,
      ),
    );
  }
}
