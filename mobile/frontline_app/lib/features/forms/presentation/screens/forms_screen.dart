import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/forms/data/models/form_assignment.dart';
import 'package:frontline_app/features/forms/providers/forms_provider.dart';

final _formFilterProvider = StateProvider<String?>((ref) => null);

class FormsScreen extends ConsumerWidget {
  const FormsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncForms = ref.watch(formsProvider);
    final filter = ref.watch(_formFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Forms & Checklists'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: () => ref.read(formsProvider.notifier).refresh(),
          ),
        ],
      ),
      body: asyncForms.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorState(
          message: err.toString(),
          onRetry: () => ref.read(formsProvider.notifier).refresh(),
        ),
        data: (assignments) {
          if (assignments.isEmpty) {
            return const _EmptyState();
          }
          final filtered = filter == null
              ? assignments
              : filter == 'todo'
                  ? assignments.where((a) => !a.completed).toList()
                  : assignments.where((a) => a.completed).toList();

          return Column(
            children: [
              _FilterRow(assignments: assignments, selected: filter),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () =>
                      ref.read(formsProvider.notifier).refresh(),
                  child: filtered.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          Center(
                            child: Text(
                              filter == 'todo'
                                  ? 'All forms completed!'
                                  : 'No completed forms yet',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(color: SproutColors.bodyText),
                            ),
                          ),
                        ])
                      : ListView.builder(
                          padding: const EdgeInsets.all(16),
                          itemCount: filtered.length,
                          itemBuilder: (_, i) =>
                              _FormAssignmentCard(
                                  assignment: filtered[i]),
                        ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

// ── Filter pills ──────────────────────────────────────────────────────────────

class _FilterRow extends ConsumerWidget {
  final List<FormAssignment> assignments;
  final String? selected;
  const _FilterRow({required this.assignments, required this.selected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final todoCount = assignments.where((a) => !a.completed).length;
    final doneCount = assignments.where((a) => a.completed).length;

    final filters = <(String?, String, int, Color)>[
      ('todo', 'To Do', todoCount, SproutColors.cyan),
      ('completed', 'Completed', doneCount, SproutColors.green),
      (null, 'All', assignments.length, SproutColors.bodyText),
    ];

    return SizedBox(
      height: 48,
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: filters.map((f) {
          final isActive = selected == f.$1;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: GestureDetector(
              onTap: () =>
                  ref.read(_formFilterProvider.notifier).state = f.$1,
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: isActive
                      ? f.$4.withValues(alpha: 0.15)
                      : SproutColors.pageBg,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: isActive
                        ? f.$4.withValues(alpha: 0.4)
                        : SproutColors.border,
                  ),
                ),
                child: Text(
                  '${f.$2} (${f.$3})',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight:
                        isActive ? FontWeight.w600 : FontWeight.normal,
                    color: isActive ? f.$4 : SproutColors.bodyText,
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

// ── Cards ──────────────────────────────────────────────────────────────────

class _FormAssignmentCard extends StatelessWidget {
  final FormAssignment assignment;
  const _FormAssignmentCard({required this.assignment});

  @override
  Widget build(BuildContext context) {
    final isChecklist = assignment.templateType == 'checklist';
    final color = assignment.completed
        ? SproutColors.green
        : assignment.isOverdue
            ? Colors.red
            : isChecklist
                ? SproutColors.green
                : SproutColors.cyan;

    String? dueLabel;
    if (assignment.dueAt != null) {
      try {
        final dt = DateTime.parse(assignment.dueAt!).toLocal();
        if (assignment.isOverdue) {
          dueLabel = 'Overdue - ${DateFormat('MMM d').format(dt)}';
        } else {
          dueLabel = 'Due ${DateFormat('MMM d, y').format(dt)}';
        }
      } catch (_) {
        dueLabel = assignment.dueAt;
      }
    }

    return GestureDetector(
      onTap: assignment.completed
          ? null
          : () => context.go('/forms/fill/${assignment.id}'),
      child: Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 4,
                height: 56,
                decoration: BoxDecoration(
                  color: color,
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
                            assignment.templateTitle,
                            style:
                                Theme.of(context).textTheme.titleMedium,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 8),
                        _TypeBadge(
                          label: isChecklist ? 'Checklist' : 'Form',
                          color: color,
                        ),
                      ],
                    ),
                    if (assignment.templateDescription != null &&
                        assignment.templateDescription!.isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Text(
                        assignment.templateDescription!,
                        style: Theme.of(context).textTheme.bodySmall,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        if (assignment.completed) ...[
                          const Icon(Icons.check_circle,
                              size: 14, color: SproutColors.green),
                          const SizedBox(width: 4),
                          const Text('Completed',
                              style: TextStyle(
                                  color: SproutColors.green,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w500)),
                        ] else if (dueLabel != null) ...[
                          Icon(
                            assignment.isOverdue
                                ? Icons.warning_amber
                                : Icons.schedule,
                            size: 14,
                            color: assignment.isOverdue
                                ? Colors.red
                                : SproutColors.bodyText,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            dueLabel,
                            style: TextStyle(
                              fontSize: 12,
                              color: assignment.isOverdue
                                  ? Colors.red
                                  : SproutColors.bodyText,
                              fontWeight: assignment.isOverdue
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
              if (!assignment.completed)
                const Icon(Icons.chevron_right,
                    color: SproutColors.bodyText),
            ],
          ),
        ),
      ),
    );
  }
}

class _TypeBadge extends StatelessWidget {
  final String label;
  final Color color;
  const _TypeBadge({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

// ── Empty / Error states ───────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.checklist_outlined,
              size: 64, color: SproutColors.border),
          const SizedBox(height: 16),
          Text('No assignments yet',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text('Your assigned forms and checklists will appear here.',
              style: Theme.of(context).textTheme.bodySmall,
              textAlign: TextAlign.center),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorState({required this.message, required this.onRetry});

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
            Text('Could not load assignments',
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
