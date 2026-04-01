import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/approvals/providers/approvals_provider.dart';

class ApprovalsScreen extends ConsumerWidget {
  const ApprovalsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncData = ref.watch(approvalsProvider);

    return DefaultTabController(
      length: 4,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Approvals'),
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh),
              onPressed: () =>
                  ref.read(approvalsProvider.notifier).refresh(),
            ),
          ],
          bottom: const TabBar(
            isScrollable: true,
            indicatorColor: SproutColors.green,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white60,
            tabs: [
              Tab(text: 'Workflows'),
              Tab(text: 'Swaps'),
              Tab(text: 'Claims'),
              Tab(text: 'Leave'),
            ],
          ),
        ),
        body: asyncData.when(
          loading: () =>
              const Center(child: CircularProgressIndicator()),
          error: (err, _) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('Could not load approvals',
                    style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () =>
                      ref.read(approvalsProvider.notifier).refresh(),
                  child: const Text('Retry'),
                ),
              ],
            ),
          ),
          data: (data) => TabBarView(
            children: [
              _WorkflowList(items: data.workflows),
              _SwapList(items: data.swaps),
              _ClaimList(items: data.claims),
              _LeaveList(items: data.leave),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Workflow approvals ────────────────────────────────────────────────────────

class _WorkflowList extends ConsumerWidget {
  final List<Map<String, dynamic>> items;
  const _WorkflowList({required this.items});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) return const _Empty('No pending workflow approvals');
    return RefreshIndicator(
      onRefresh: () => ref.read(approvalsProvider.notifier).refresh(),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        itemBuilder: (_, i) => _WorkflowCard(item: items[i]),
      ),
    );
  }
}

class _WorkflowCard extends ConsumerWidget {
  final Map<String, dynamic> item;
  const _WorkflowCard({required this.item});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final stageName = item['stage_name'] as String? ?? 'Workflow Step';
    final actionType = item['action_type'] as String? ?? '';
    final dueAt = item['due_at'] as String?;
    final instanceId = item['workflow_instance_id'] as String? ??
        item['instance_id'] as String? ??
        '';
    final stageInstanceId = item['id'] as String? ?? '';

    final actionLabel = actionType == 'approve'
        ? 'Needs approval'
        : actionType == 'sign'
            ? 'Needs signature'
            : actionType == 'review'
                ? 'Needs review'
                : 'Action required';

    return _ApprovalCard(
      title: stageName,
      subtitle: actionLabel,
      dueAt: dueAt,
      onApprove: () async {
        final repo = ref.read(approvalsRepositoryProvider);
        await repo.approveWorkflowStage(
          instanceId: instanceId,
          stageInstanceId: stageInstanceId,
        );
        ref.read(approvalsProvider.notifier).refresh();
      },
      onReject: () => _showRejectDialog(context, ref, instanceId, stageInstanceId),
    );
  }

  void _showRejectDialog(BuildContext context, WidgetRef ref,
      String instanceId, String stageInstanceId) {
    final ctrl = TextEditingController();
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Reject'),
        content: TextField(
          controller: ctrl,
          decoration:
              const InputDecoration(hintText: 'Reason (required)'),
          maxLines: 3,
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              if (ctrl.text.trim().isEmpty) return;
              Navigator.pop(context);
              final repo = ref.read(approvalsRepositoryProvider);
              await repo.rejectWorkflowStage(
                instanceId: instanceId,
                stageInstanceId: stageInstanceId,
                comment: ctrl.text.trim(),
              );
              ref.read(approvalsProvider.notifier).refresh();
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Reject'),
          ),
        ],
      ),
    );
  }
}

// ── Swap approvals ────────────────────────────────────────────────────────────

class _SwapList extends ConsumerWidget {
  final List<Map<String, dynamic>> items;
  const _SwapList({required this.items});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) return const _Empty('No pending swap requests');
    return RefreshIndicator(
      onRefresh: () => ref.read(approvalsProvider.notifier).refresh(),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        itemBuilder: (_, i) {
          final item = items[i];
          final id = item['id'] as String? ?? '';
          final profile = item['profiles'] as Map?;
          final name = profile?['full_name'] as String? ?? 'Staff';
          return _ApprovalCard(
            title: 'Shift Swap Request',
            subtitle: 'From $name',
            onApprove: () async {
              final repo = ref.read(approvalsRepositoryProvider);
              await repo.respondToSwap(id, 'approve');
              ref.read(approvalsProvider.notifier).refresh();
            },
            onReject: () async {
              final repo = ref.read(approvalsRepositoryProvider);
              await repo.respondToSwap(id, 'reject');
              ref.read(approvalsProvider.notifier).refresh();
            },
          );
        },
      ),
    );
  }
}

// ── Claim approvals ───────────────────────────────────────────────────────────

class _ClaimList extends ConsumerWidget {
  final List<Map<String, dynamic>> items;
  const _ClaimList({required this.items});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) return const _Empty('No pending shift claims');
    return RefreshIndicator(
      onRefresh: () => ref.read(approvalsProvider.notifier).refresh(),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        itemBuilder: (_, i) {
          final item = items[i];
          final id = item['id'] as String? ?? '';
          final profile = item['profiles'] as Map?;
          final name = profile?['full_name'] as String? ?? 'Staff';
          return _ApprovalCard(
            title: 'Shift Claim',
            subtitle: '$name wants to claim this shift',
            onApprove: () async {
              final repo = ref.read(approvalsRepositoryProvider);
              await repo.respondToClaim(id, 'approve');
              ref.read(approvalsProvider.notifier).refresh();
            },
            onReject: () async {
              final repo = ref.read(approvalsRepositoryProvider);
              await repo.respondToClaim(id, 'reject');
              ref.read(approvalsProvider.notifier).refresh();
            },
          );
        },
      ),
    );
  }
}

// ── Leave approvals ───────────────────────────────────────────────────────────

class _LeaveList extends ConsumerWidget {
  final List<Map<String, dynamic>> items;
  const _LeaveList({required this.items});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (items.isEmpty) return const _Empty('No pending leave requests');
    return RefreshIndicator(
      onRefresh: () => ref.read(approvalsProvider.notifier).refresh(),
      child: ListView.builder(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        itemBuilder: (_, i) {
          final item = items[i];
          final id = item['id'] as String? ?? '';
          final profile = item['profiles'] as Map?;
          final name = profile?['full_name'] as String? ?? 'Staff';
          final leaveType = item['leave_type'] as String? ?? 'leave';
          final startDate = item['start_date'] as String? ?? '';
          final endDate = item['end_date'] as String? ?? '';
          return _ApprovalCard(
            title: '${leaveType[0].toUpperCase()}${leaveType.substring(1)} Leave',
            subtitle: '$name · $startDate to $endDate',
            onApprove: () async {
              final repo = ref.read(approvalsRepositoryProvider);
              await repo.respondToLeave(id, 'approve');
              ref.read(approvalsProvider.notifier).refresh();
            },
            onReject: () async {
              final repo = ref.read(approvalsRepositoryProvider);
              await repo.respondToLeave(id, 'reject');
              ref.read(approvalsProvider.notifier).refresh();
            },
          );
        },
      ),
    );
  }
}

// ── Shared approval card ──────────────────────────────────────────────────────

class _ApprovalCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final String? dueAt;
  final VoidCallback onApprove;
  final VoidCallback onReject;

  const _ApprovalCard({
    required this.title,
    required this.subtitle,
    this.dueAt,
    required this.onApprove,
    required this.onReject,
  });

  @override
  Widget build(BuildContext context) {
    String? dueLabel;
    if (dueAt != null) {
      final dt = DateTime.tryParse(dueAt!)?.toLocal();
      if (dt != null) dueLabel = 'Due ${DateFormat('MMM d').format(dt)}';
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title,
                style: const TextStyle(
                    fontSize: 15, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(subtitle,
                style: Theme.of(context).textTheme.bodySmall),
            if (dueLabel != null) ...[
              const SizedBox(height: 2),
              Text(dueLabel,
                  style: const TextStyle(
                      fontSize: 12, color: SproutColors.bodyText)),
            ],
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onReject,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: Colors.red,
                      side: const BorderSide(color: Colors.red),
                    ),
                    child: const Text('Reject'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: ElevatedButton(
                    onPressed: onApprove,
                    child: const Text('Approve'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  final String message;
  const _Empty(this.message);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.check_circle_outline,
              size: 48, color: SproutColors.border),
          const SizedBox(height: 12),
          Text(message, style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}
