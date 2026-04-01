import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/tasks/data/models/task_models.dart';
import 'package:frontline_app/features/tasks/providers/tasks_provider.dart';

final _taskFilterProvider = StateProvider<String?>((ref) => null);

class TasksScreen extends ConsumerWidget {
  const TasksScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncTasks = ref.watch(myTasksProvider);
    final filter = ref.watch(_taskFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Tasks'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: () => ref.read(myTasksProvider.notifier).refresh(),
          ),
        ],
      ),
      body: asyncTasks.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorBody(
          message: err.toString(),
          onRetry: () => ref.read(myTasksProvider.notifier).refresh(),
        ),
        data: (tasks) {
          if (tasks.isEmpty) {
            return const _EmptyState();
          }
          final filtered = filter == null
              ? tasks
              : tasks.where((t) => t.status == filter).toList();

          return Column(
            children: [
              _StatusFilterRow(tasks: tasks, selected: filter),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () =>
                      ref.read(myTasksProvider.notifier).refresh(),
                  child: filtered.isEmpty
                      ? ListView(
                          children: [
                            const SizedBox(height: 80),
                            Center(
                              child: Text('No ${_filterLabel(filter)} tasks',
                                  style: Theme.of(context)
                                      .textTheme
                                      .bodyMedium
                                      ?.copyWith(
                                          color: SproutColors.bodyText)),
                            ),
                          ],
                        )
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: filtered.length,
                          itemBuilder: (_, i) =>
                              _TaskCard(task: filtered[i]),
                        ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  String _filterLabel(String? f) {
    switch (f) {
      case 'pending': return 'pending';
      case 'in_progress': return 'in-progress';
      case 'completed': return 'completed';
      default: return '';
    }
  }
}

// ── Status filter pills ───────────────────────────────────────────────────────

class _StatusFilterRow extends ConsumerWidget {
  final List<Task> tasks;
  final String? selected;
  const _StatusFilterRow({required this.tasks, required this.selected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final counts = <String?, int>{};
    counts[null] = tasks.length;
    for (final t in tasks) {
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }

    const filters = <(String?, String, Color)>[
      (null, 'All', SproutColors.bodyText),
      ('pending', 'Pending', SproutColors.cyan),
      ('in_progress', 'In Progress', Colors.orange),
      ('completed', 'Completed', SproutColors.green),
    ];

    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: filters.map((f) {
          final count = counts[f.$1] ?? 0;
          final isActive = selected == f.$1;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () =>
                  ref.read(_taskFilterProvider.notifier).state = f.$1,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: isActive
                      ? f.$3.withValues(alpha: 0.15)
                      : SproutColors.pageBg,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isActive
                        ? f.$3.withValues(alpha: 0.4)
                        : SproutColors.border,
                  ),
                ),
                child: Text(
                  '${f.$2} ($count)',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isActive ? FontWeight.w600 : FontWeight.normal,
                    color: isActive ? f.$3 : SproutColors.bodyText,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

// ── Task card ─────────────────────────────────────────────────────────────────

class _TaskCard extends StatelessWidget {
  final Task task;
  const _TaskCard({required this.task});

  @override
  Widget build(BuildContext context) {
    final priorityColor = _priorityColor(task.priority);

    String? dueLabel;
    if (task.dueAt != null) {
      final dt = DateTime.tryParse(task.dueAt!)?.toLocal();
      if (dt != null) dueLabel = DateFormat('MMM d, y').format(dt);
    }

    return GestureDetector(
      onTap: () => context.go('/tasks/${task.id}'),
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Priority indicator bar
              Container(
                width: 4,
                height: 52,
                decoration: BoxDecoration(
                  color: priorityColor,
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
                        Expanded(
                          child: Text(
                            task.title,
                            style: Theme.of(context).textTheme.titleMedium,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _PriorityBadge(
                            priority: task.priority, color: priorityColor),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        _StatusChip(status: task.status),
                        if (dueLabel != null) ...[
                          const SizedBox(width: 8),
                          Icon(
                            task.isOverdue
                                ? Icons.warning_amber
                                : Icons.schedule,
                            size: 14,
                            color: task.isOverdue
                                ? Colors.red
                                : SproutColors.bodyText,
                          ),
                          const SizedBox(width: 3),
                          Text(
                            dueLabel,
                            style: TextStyle(
                              fontSize: 12,
                              color: task.isOverdue
                                  ? Colors.red
                                  : SproutColors.bodyText,
                              fontWeight: task.isOverdue
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: SproutColors.bodyText),
            ],
          ),
        ),
      ),
    );
  }

  Color _priorityColor(String p) {
    switch (p) {
      case 'critical':
        return Colors.red;
      case 'high':
        return Colors.deepOrange;
      case 'medium':
        return Colors.orange;
      case 'low':
        return Colors.green;
      default:
        return SproutColors.bodyText;
    }
  }
}

class _PriorityBadge extends StatelessWidget {
  final String priority;
  final Color color;
  const _PriorityBadge({required this.priority, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        priority[0].toUpperCase() + priority.substring(1),
        style: TextStyle(
            color: color, fontSize: 11, fontWeight: FontWeight.w600),
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  final String status;
  const _StatusChip({required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, color) = _statusInfo(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 11, fontWeight: FontWeight.w500)),
    );
  }

  (String, Color) _statusInfo(String s) {
    switch (s) {
      case 'open':
      case 'pending':
        return ('Pending', SproutColors.cyan);
      case 'in_progress':
        return ('In Progress', Colors.orange);
      case 'completed':
        return ('Completed', SproutColors.green);
      default:
        return (s, SproutColors.bodyText);
    }
  }
}

// ── Empty / Error ─────────────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.task_alt_outlined,
              size: 64, color: SproutColors.border),
          const SizedBox(height: 16),
          Text('No tasks assigned',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text('Tasks assigned to you will appear here.',
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
            Text('Could not load tasks',
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
