import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/issues/data/models/issue_models.dart';
import 'package:frontline_app/features/issues/providers/issues_provider.dart';

final _issueFilterProvider = StateProvider<String?>((ref) => null);

class IssuesScreen extends ConsumerWidget {
  const IssuesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncIssues = ref.watch(myIssuesProvider);
    final filter = ref.watch(_issueFilterProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Issues'),
        actions: [
          // AI Sidekick button
          IconButton(
            icon: const Icon(Icons.auto_awesome, size: 22),
            tooltip: 'Ask Sidekick',
            onPressed: () => _showSidekick(context),
          ),
          IconButton(
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
            onPressed: () =>
                ref.read(myIssuesProvider.notifier).refresh(),
          ),
        ],
      ),
      body: asyncIssues.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => _ErrorBody(
          message: err.toString(),
          onRetry: () => ref.read(myIssuesProvider.notifier).refresh(),
        ),
        data: (issues) {
          if (issues.isEmpty) {
            return const _EmptyState();
          }
          final filtered = filter == null
              ? issues
              : issues.where((i) => i.status == filter).toList();

          return Column(
            children: [
              _StatusFilterRow(issues: issues, selected: filter),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () =>
                      ref.read(myIssuesProvider.notifier).refresh(),
                  child: filtered.isEmpty
                      ? ListView(children: [
                          const SizedBox(height: 80),
                          Center(
                            child: Text(
                              'No ${_statusLabel(filter)} issues',
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
                              _IssueCard(issue: filtered[i]),
                        ),
                ),
              ),
            ],
          );
        },
      ),
      // FAB to report new issue
      floatingActionButton: FloatingActionButton(
        heroTag: 'report_issue_fab',
        onPressed: () => context.go('/issues/report'),
        backgroundColor: SproutColors.green,
        child: const Icon(Icons.add, color: Colors.white),
      ),
    );
  }

  String _statusLabel(String? s) {
    switch (s) {
      case 'open': return 'open';
      case 'in_progress': return 'in-progress';
      case 'pending_vendor': return 'pending vendor';
      case 'resolved': return 'resolved';
      case 'verified_closed': return 'closed';
      default: return '';
    }
  }

  void _showSidekick(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const _SidekickSheet(),
    );
  }
}

// ── Status filter pills ───────────────────────────────────────────────────────

class _StatusFilterRow extends ConsumerWidget {
  final List<Issue> issues;
  final String? selected;
  const _StatusFilterRow({required this.issues, required this.selected});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final counts = <String?, int>{};
    counts[null] = issues.length;
    for (final i in issues) {
      counts[i.status] = (counts[i.status] ?? 0) + 1;
    }

    const filters = <(String?, String, Color)>[
      (null, 'All', SproutColors.bodyText),
      ('open', 'Open', SproutColors.cyan),
      ('in_progress', 'In Progress', Colors.orange),
      ('pending_vendor', 'Pending Vendor', SproutColors.purple),
      ('resolved', 'Resolved', SproutColors.green),
      ('verified_closed', 'Closed', Colors.grey),
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
                  ref.read(_issueFilterProvider.notifier).state = f.$1,
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
                    fontWeight:
                        isActive ? FontWeight.w600 : FontWeight.normal,
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

// ── Issue card ────────────────────────────────────────────────────────────────

class _IssueCard extends StatelessWidget {
  final Issue issue;
  const _IssueCard({required this.issue});

  @override
  Widget build(BuildContext context) {
    final priorityColor = _priorityColor(issue.priority);
    final (statusLabel, statusColor) = _statusInfo(issue.status);

    final dt = DateTime.tryParse(issue.createdAt)?.toLocal();
    final timeAgo = dt != null ? _timeAgo(dt) : '';

    return GestureDetector(
      onTap: () => context.go('/issues/${issue.id}'),
      child: Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
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
                          issue.title,
                          style: Theme.of(context).textTheme.titleMedium,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      _PriorityBadge(
                          priority: issue.priority, color: priorityColor),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      _StatusPill(label: statusLabel, color: statusColor),
                      if (issue.categoryName != null) ...[
                        const SizedBox(width: 6),
                        Flexible(
                          child: Text(
                            issue.categoryName!,
                            style: const TextStyle(
                                fontSize: 12,
                                color: SproutColors.bodyText),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      if (issue.locationName != null) ...[
                        const Icon(Icons.place,
                            size: 12, color: SproutColors.bodyText),
                        const SizedBox(width: 2),
                        Flexible(
                          child: Text(issue.locationName!,
                              style: Theme.of(context).textTheme.bodySmall,
                              overflow: TextOverflow.ellipsis),
                        ),
                        const SizedBox(width: 8),
                      ],
                      Text(timeAgo,
                          style: Theme.of(context).textTheme.bodySmall),
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
      case 'critical': return Colors.red;
      case 'high': return Colors.deepOrange;
      case 'medium': return Colors.orange;
      default: return Colors.green;
    }
  }

  (String, Color) _statusInfo(String s) {
    switch (s) {
      case 'open': return ('Open', SproutColors.cyan);
      case 'in_progress': return ('In Progress', Colors.orange);
      case 'pending_vendor': return ('Pending Vendor', SproutColors.purple);
      case 'resolved': return ('Resolved', SproutColors.green);
      case 'verified_closed': return ('Closed', Colors.grey);
      default: return (s, SproutColors.bodyText);
    }
  }

  String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inDays > 0) return '${diff.inDays}d ago';
    if (diff.inHours > 0) return '${diff.inHours}h ago';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m ago';
    return 'Just now';
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

class _StatusPill extends StatelessWidget {
  final String label;
  final Color color;
  const _StatusPill({required this.label, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 11, fontWeight: FontWeight.w500)),
    );
  }
}

// ── Sidekick AI sheet ─────────────────────────────────────────────────────────

class _SidekickSheet extends StatefulWidget {
  const _SidekickSheet();

  @override
  State<_SidekickSheet> createState() => _SidekickSheetState();
}

class _SidekickSheetState extends State<_SidekickSheet> {
  final _controller = TextEditingController();
  final _scrollController = ScrollController();
  final List<Map<String, String>> _messages = [];
  bool _loading = false;

  @override
  void dispose() {
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _send(String text) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty || _loading) return;
    _controller.clear();
    setState(() {
      _messages.add({'role': 'user', 'content': trimmed});
      _loading = true;
    });
    _scrollToBottom();

    try {
      final response = await DioClient.instance.post<Map<String, dynamic>>(
        '/api/v1/ai/chat',
        data: {
          'messages': _messages
              .map((m) => {'role': m['role'], 'content': m['content']})
              .toList(),
        },
      );
      final reply = (response.data?['reply'] as String?) ?? '';
      setState(() {
        _messages.add({'role': 'assistant', 'content': reply});
      });
    } catch (e) {
      setState(() {
        _messages.add({
          'role': 'assistant',
          'content': 'Sorry, something went wrong. Please try again.',
        });
      });
    } finally {
      setState(() => _loading = false);
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

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.5,
      maxChildSize: 0.85,
      minChildSize: 0.3,
      builder: (_, __) => Container(
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
                color: SproutColors.border,
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
                      color: SproutColors.purple,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Icon(Icons.auto_awesome,
                        size: 16, color: Colors.white),
                  ),
                  const SizedBox(width: 10),
                  const Text('Sidekick',
                      style: TextStyle(
                          fontSize: 17, fontWeight: FontWeight.w600)),
                ],
              ),
            ),
            // Suggestion chips — only shown when no messages yet
            if (_messages.isEmpty)
              SizedBox(
                height: 36,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  children: [
                    _SuggestionChip(
                        label: 'Summarize open issues',
                        onTap: () => _send('Summarize open issues')),
                    _SuggestionChip(
                        label: "What's overdue?",
                        onTap: () => _send("What's overdue?")),
                    _SuggestionChip(
                        label: 'SLA breaches today',
                        onTap: () => _send('SLA breaches today')),
                  ],
                ),
              ),
            // Message list
            Expanded(
              child: _messages.isEmpty
                  ? const Center(
                      child: Text('Ask anything about your operations.',
                          style: TextStyle(color: Colors.grey, fontSize: 13)),
                    )
                  : ListView.builder(
                      controller: _scrollController,
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 8),
                      itemCount: _messages.length + (_loading ? 1 : 0),
                      itemBuilder: (_, index) {
                        if (index == _messages.length) {
                          return const Padding(
                            padding: EdgeInsets.symmetric(vertical: 8),
                            child: Row(
                              children: [
                                SizedBox(width: 8),
                                SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(
                                      strokeWidth: 2),
                                ),
                                SizedBox(width: 8),
                                Text('Thinking...',
                                    style: TextStyle(
                                        color: Colors.grey, fontSize: 13)),
                              ],
                            ),
                          );
                        }
                        final msg = _messages[index];
                        final isUser = msg['role'] == 'user';
                        return Align(
                          alignment: isUser
                              ? Alignment.centerRight
                              : Alignment.centerLeft,
                          child: Container(
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 8),
                            constraints: BoxConstraints(
                                maxWidth:
                                    MediaQuery.of(context).size.width * 0.78),
                            decoration: BoxDecoration(
                              color: isUser
                                  ? SproutColors.green
                                  : const Color(0xFFF3F4F6),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              msg['content'] ?? '',
                              style: TextStyle(
                                fontSize: 14,
                                color: isUser ? Colors.white : Colors.black87,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
            // Chat input
            Container(
              padding: EdgeInsets.only(
                left: 12,
                right: 8,
                top: 8,
                bottom: MediaQuery.of(context).padding.bottom + 8,
              ),
              decoration: const BoxDecoration(
                border:
                    Border(top: BorderSide(color: SproutColors.border)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      textInputAction: TextInputAction.send,
                      onSubmitted: _send,
                      decoration: const InputDecoration(
                        hintText: 'Ask anything...',
                        border: InputBorder.none,
                        isDense: true,
                        contentPadding: EdgeInsets.symmetric(
                            horizontal: 12, vertical: 10),
                      ),
                    ),
                  ),
                  IconButton(
                    icon: const Icon(Icons.send, color: SproutColors.green),
                    onPressed: _loading
                        ? null
                        : () => _send(_controller.text),
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
          padding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: SproutColors.pageBg,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: SproutColors.border),
          ),
          child: Text(label,
              style: const TextStyle(fontSize: 13)),
        ),
      ),
    );
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
          const Icon(Icons.check_circle_outline,
              size: 64, color: SproutColors.border),
          const SizedBox(height: 16),
          Text('No issues reported',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text('Tap + to report a problem.',
              style: Theme.of(context).textTheme.bodySmall),
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
            Text('Could not load issues',
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
