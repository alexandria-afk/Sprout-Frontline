import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/notifications/data/models/inbox_models.dart';
import 'package:frontline_app/features/notifications/providers/notifications_provider.dart';

// ── Kind → icon / color map ───────────────────────────────────────────────────

const _kindMeta = <String, (IconData, Color, String)>{
  'task':         (Icons.check_box_outlined,   Color(0xFF1D9E75), 'Task'),
  'form':         (Icons.checklist,            Color(0xFFD97706), 'Form'),
  'workflow':     (Icons.account_tree,         Color(0xFF7C3AED), 'Workflow'),
  'course':       (Icons.school,               Color(0xFF2563EB), 'Training'),
  'announcement': (Icons.campaign,             Color(0xFF7C3AED), 'Announcement'),
  'issue':        (Icons.warning_amber,        Color(0xFFEA580C), 'Issue'),
  // Manager / admin / super_admin action items
  'shift_claim':    (Icons.event_available,    Color(0xFF0D9488), 'Shift Claim'),
  'shift_swap':     (Icons.swap_horiz,         Color(0xFF0891B2), 'Shift Swap'),
  'leave_request':  (Icons.calendar_month,     Color(0xFF4F46E5), 'Leave'),
  'form_review':    (Icons.fact_check,         Color(0xFFD97706), 'Review'),
  'cap':            (Icons.verified_user,      Color(0xFFDC2626), 'CAP'),
};

(IconData, Color, String) _metaFor(String kind) {
  return _kindMeta[kind] ?? (Icons.task_alt, SproutColors.bodyText, kind);
}

// ── Screen ───────────────────────────────────────────────────────────────────

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncItems = ref.watch(todoItemsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My To-Do List'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: () =>
                ref.read(todoItemsProvider.notifier).refresh(),
          ),
        ],
      ),
      body: asyncItems.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorBody(
          message: err.toString(),
          onRetry: () => ref.read(todoItemsProvider.notifier).refresh(),
        ),
        data: (items) {
          if (items.isEmpty) return const _EmptyState();
          return RefreshIndicator(
            onRefresh: () => ref.read(todoItemsProvider.notifier).refresh(),
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(vertical: 4),
              itemCount: items.length,
              itemBuilder: (_, i) => _TodoTile(item: items[i]),
            ),
          );
        },
      ),
    );
  }
}

// ── To-Do tile ────────────────────────────────────────────────────────────────

class _TodoTile extends StatelessWidget {
  final InboxItem item;
  const _TodoTile({required this.item});

  @override
  Widget build(BuildContext context) {
    final (icon, color, label) = _metaFor(item.kind);
    final dueText = _dueBadge(item.dueAt, item.isOverdue);

    return InkWell(
      onTap: () => context.go(item.route),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        decoration: const BoxDecoration(
          border: Border(
            bottom: BorderSide(color: SproutColors.border, width: 0.5),
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Kind icon
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Icon(icon, size: 18, color: color),
            ),
            const SizedBox(width: 12),
            // Content
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: SproutColors.darkText,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (item.description != null &&
                      item.description!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      item.description!,
                      style: const TextStyle(
                        fontSize: 13,
                        color: SproutColors.bodyText,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (dueText != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      dueText,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: item.isOverdue
                            ? const Color(0xFFEF4444)
                            : SproutColors.bodyText,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(width: 8),
            // Kind badge
            Container(
              padding:
                  const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String? _dueBadge(DateTime? due, bool overdue) {
    if (due == null) return null;
    final now = DateTime.now();
    final diff = overdue ? now.difference(due) : due.difference(now);
    final hours = diff.inHours;
    final days = diff.inDays;
    if (overdue) {
      return hours < 24 ? 'Due today' : '${days}d overdue';
    }
    if (hours < 1) return 'Due in <1h';
    if (hours < 24) return 'Due in ${hours}h';
    if (days == 1) return 'Due tomorrow';
    return 'Due in ${days}d';
  }
}

// ── Empty / Error states ─────────────────────────────────────────────────────

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.check_circle_outline,
              size: 64, color: Color(0xFF1D9E75)),
          const SizedBox(height: 16),
          Text("You're all caught up!",
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text('No pending items.',
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
            Text('Could not load to-do list',
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
