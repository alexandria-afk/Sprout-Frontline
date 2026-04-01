import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/tasks/data/models/task_models.dart';
import 'package:frontline_app/features/tasks/providers/tasks_provider.dart';

class TaskDetailScreen extends ConsumerWidget {
  final String taskId;
  const TaskDetailScreen({super.key, required this.taskId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncDetail = ref.watch(taskDetailProvider(taskId));

    return asyncDetail.when(
      loading: () => Scaffold(
        appBar: AppBar(
          title: const Text('Task'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/tasks'),
          ),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (err, _) => Scaffold(
        appBar: AppBar(
          title: const Text('Task'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/tasks'),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Failed to load task',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.invalidate(taskDetailProvider(taskId)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      data: (detail) => _DetailBody(taskId: taskId, detail: detail),
    );
  }
}

class _DetailBody extends ConsumerStatefulWidget {
  final String taskId;
  final TaskDetail detail;
  const _DetailBody({required this.taskId, required this.detail});

  @override
  ConsumerState<_DetailBody> createState() => _DetailBodyState();
}

class _DetailBodyState extends ConsumerState<_DetailBody> {
  final _msgCtrl = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _msgCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.detail.task;
    final messages = widget.detail.messages;

    String? dueLabel;
    if (task.dueAt != null) {
      final dt = DateTime.tryParse(task.dueAt!)?.toLocal();
      if (dt != null) dueLabel = DateFormat('MMM d, y – h:mm a').format(dt);
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Task Detail'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/tasks'),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Title + priority
                Text(task.title,
                    style: Theme.of(context).textTheme.titleLarge),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  children: [
                    _PriorityBadge(priority: task.priority),
                    _StatusBadge(status: task.status),
                    if (task.isOverdue)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.red.withValues(alpha: 0.12),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: const Text('OVERDUE',
                            style: TextStyle(
                                color: Colors.red,
                                fontSize: 11,
                                fontWeight: FontWeight.w700)),
                      ),
                  ],
                ),

                // Description
                if (task.description != null &&
                    task.description!.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(task.description!,
                      style: Theme.of(context).textTheme.bodyMedium),
                ],

                // Metadata
                const SizedBox(height: 16),
                const Divider(),
                if (dueLabel != null)
                  _MetaRow(icon: Icons.schedule, label: 'Due', value: dueLabel),
                if (task.locationName != null)
                  _MetaRow(
                      icon: Icons.place,
                      label: 'Location',
                      value: task.locationName!),
                _MetaRow(
                    icon: Icons.category_outlined,
                    label: 'Source',
                    value: task.sourceType),
                const Divider(),

                // Status actions
                const SizedBox(height: 12),
                Text('Update Status',
                    style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                _StatusButtons(
                  current: task.status,
                  onChanged: (s) async {
                    try {
                      await ref
                          .read(taskDetailProvider(widget.taskId).notifier)
                          .updateStatus(s);
                      // Also refresh the list so the card updates.
                      ref.read(myTasksProvider.notifier).refresh();
                    } catch (e) {
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(content: Text('Failed: $e')),
                        );
                      }
                    }
                  },
                ),

                // Messages thread
                const SizedBox(height: 24),
                Text('Messages (${messages.length})',
                    style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 8),
                if (messages.isEmpty)
                  Text('No messages yet.',
                      style: Theme.of(context).textTheme.bodySmall)
                else
                  ...messages.map((m) => _MessageBubble(message: m)),
              ],
            ),
          ),

          // Message input
          _MessageInput(
            controller: _msgCtrl,
            sending: _sending,
            onSend: () async {
              final body = _msgCtrl.text.trim();
              if (body.isEmpty) return;
              setState(() => _sending = true);
              try {
                await ref
                    .read(taskDetailProvider(widget.taskId).notifier)
                    .postMessage(body);
                _msgCtrl.clear();
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Send failed: $e')),
                  );
                }
              } finally {
                if (mounted) setState(() => _sending = false);
              }
            },
          ),
        ],
      ),
    );
  }
}

// ── Badges ────────────────────────────────────────────────────────────────────

class _PriorityBadge extends StatelessWidget {
  final String priority;
  const _PriorityBadge({required this.priority});

  @override
  Widget build(BuildContext context) {
    final color = _color(priority);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(
        priority[0].toUpperCase() + priority.substring(1),
        style:
            TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600),
      ),
    );
  }

  Color _color(String p) {
    switch (p) {
      case 'critical': return Colors.red;
      case 'high': return Colors.deepOrange;
      case 'medium': return Colors.orange;
      default: return Colors.green;
    }
  }
}

class _StatusBadge extends StatelessWidget {
  final String status;
  const _StatusBadge({required this.status});

  @override
  Widget build(BuildContext context) {
    final (label, color) = _info(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 12, fontWeight: FontWeight.w500)),
    );
  }

  (String, Color) _info(String s) {
    switch (s) {
      case 'open':
      case 'pending': return ('Pending', SproutColors.cyan);
      case 'in_progress': return ('In Progress', Colors.orange);
      case 'completed': return ('Completed', SproutColors.green);
      default: return (s, SproutColors.bodyText);
    }
  }
}

// ── Metadata row ──────────────────────────────────────────────────────────────

class _MetaRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  const _MetaRow(
      {required this.icon, required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 16, color: SproutColors.bodyText),
          const SizedBox(width: 8),
          Text('$label: ',
              style: const TextStyle(
                  fontSize: 13, fontWeight: FontWeight.w500)),
          Expanded(
            child: Text(value,
                style: Theme.of(context).textTheme.bodySmall,
                overflow: TextOverflow.ellipsis),
          ),
        ],
      ),
    );
  }
}

// ── Status buttons ────────────────────────────────────────────────────────────

class _StatusButtons extends StatelessWidget {
  final String current;
  final ValueChanged<String> onChanged;
  const _StatusButtons({required this.current, required this.onChanged});

  static const _statuses = [
    ('pending', 'Pending', Icons.radio_button_unchecked),
    ('in_progress', 'In Progress', Icons.play_circle_outline),
    ('completed', 'Completed', Icons.check_circle_outline),
  ];

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: _statuses.map((s) {
        final isActive = s.$1 == current;
        return ChoiceChip(
          avatar: Icon(s.$3, size: 16),
          label: Text(s.$2),
          selected: isActive,
          selectedColor: SproutColors.green.withValues(alpha: 0.15),
          onSelected: isActive ? null : (_) => onChanged(s.$1),
        );
      }).toList(),
    );
  }
}

// ── Message bubble ────────────────────────────────────────────────────────────

class _MessageBubble extends StatelessWidget {
  final TaskMessage message;
  const _MessageBubble({required this.message});

  @override
  Widget build(BuildContext context) {
    final dt = DateTime.tryParse(message.createdAt)?.toLocal();
    final timeStr =
        dt != null ? DateFormat('MMM d, h:mm a').format(dt) : '';

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: SproutColors.pageBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: SproutColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                message.userName ?? 'Unknown',
                style: const TextStyle(
                    fontWeight: FontWeight.w600, fontSize: 13),
              ),
              Text(timeStr,
                  style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
          const SizedBox(height: 4),
          Text(message.body,
              style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}

// ── Message input ─────────────────────────────────────────────────────────────

class _MessageInput extends StatelessWidget {
  final TextEditingController controller;
  final bool sending;
  final VoidCallback onSend;
  const _MessageInput(
      {required this.controller,
      required this.sending,
      required this.onSend});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 12,
        right: 8,
        top: 8,
        bottom: MediaQuery.of(context).padding.bottom + 8,
      ),
      decoration: const BoxDecoration(
        color: SproutColors.cardBg,
        border: Border(top: BorderSide(color: SproutColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: controller,
              decoration: const InputDecoration(
                hintText: 'Write a message...',
                border: InputBorder.none,
                isDense: true,
                contentPadding:
                    EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              ),
              textInputAction: TextInputAction.send,
              onSubmitted: (_) => onSend(),
            ),
          ),
          sending
              ? const Padding(
                  padding: EdgeInsets.all(8),
                  child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2)),
                )
              : IconButton(
                  icon: const Icon(Icons.send, color: SproutColors.green),
                  onPressed: onSend,
                ),
        ],
      ),
    );
  }
}
