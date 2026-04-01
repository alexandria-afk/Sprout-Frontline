import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/issues/providers/issues_provider.dart';

final _issueDetailProvider =
    FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  final repo = ref.read(issuesRepositoryProvider);
  return repo.getIssue(id);
});

class IssueDetailScreen extends ConsumerWidget {
  final String issueId;
  const IssueDetailScreen({super.key, required this.issueId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncDetail = ref.watch(_issueDetailProvider(issueId));

    return asyncDetail.when(
      loading: () => Scaffold(
        appBar: AppBar(
          title: const Text('Issue'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/issues'),
          ),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (err, _) => Scaffold(
        appBar: AppBar(
          title: const Text('Issue'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/issues'),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Failed to load issue',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.invalidate(_issueDetailProvider(issueId)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      data: (data) => _DetailBody(issueId: issueId, data: data),
    );
  }
}

class _DetailBody extends ConsumerStatefulWidget {
  final String issueId;
  final Map<String, dynamic> data;
  const _DetailBody({required this.issueId, required this.data});

  @override
  ConsumerState<_DetailBody> createState() => _DetailBodyState();
}

class _DetailBodyState extends ConsumerState<_DetailBody> {
  final _commentCtrl = TextEditingController();
  bool _sending = false;

  @override
  void dispose() {
    _commentCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final d = widget.data;
    final title = d['title'] as String? ?? '';
    final description = d['description'] as String? ?? '';
    final status = d['status'] as String? ?? 'open';
    final priority = d['priority'] as String? ?? 'medium';
    final locationDesc = d['location_description'] as String?;
    final createdAt = d['created_at'] as String?;

    final cat = d['issue_categories'] as Map?;
    final loc = d['locations'] as Map?;
    final profile = d['profiles'] as Map?;

    final attachments = (d['issue_attachments'] as List?) ?? [];
    final comments = (d['issue_comments'] as List?) ?? [];
    final history = (d['issue_status_history'] as List?) ?? [];

    final dt = createdAt != null
        ? DateTime.tryParse(createdAt)?.toLocal()
        : null;
    final dateStr =
        dt != null ? DateFormat('MMM d, y – h:mm a').format(dt) : '';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Issue Detail'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/issues'),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Title + badges
                Text(title,
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w600)),
                const SizedBox(height: 8),
                Wrap(spacing: 8, children: [
                  _pill(_statusLabel(status), _statusColor(status)),
                  _pill(priority[0].toUpperCase() + priority.substring(1),
                      _priorityColor(priority)),
                  if (cat != null)
                    _pill(cat['name'] as String? ?? '', SproutColors.purple),
                ]),

                // Meta
                const SizedBox(height: 16),
                if (loc != null)
                  _meta(Icons.place_outlined, loc['name'] as String? ?? ''),
                if (locationDesc != null && locationDesc.isNotEmpty)
                  _meta(Icons.pin_drop_outlined, locationDesc),
                if (profile != null)
                  _meta(Icons.person_outline,
                      'Reported by ${profile['full_name'] ?? 'Unknown'}'),
                if (dateStr.isNotEmpty)
                  _meta(Icons.schedule, dateStr),

                // Description
                if (description.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  Text(description,
                      style: Theme.of(context).textTheme.bodyMedium),
                ],

                // Photos
                if (attachments.isNotEmpty) ...[
                  const SizedBox(height: 16),
                  const Text('Photos',
                      style: TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14)),
                  const SizedBox(height: 8),
                  SizedBox(
                    height: 140,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: attachments.length,
                      itemBuilder: (_, i) {
                        final a = Map<String, dynamic>.from(
                            attachments[i] as Map);
                        final url = a['file_url'] as String? ?? '';
                        return Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(10),
                            child: Image.network(url,
                                width: 180, fit: BoxFit.cover,
                                errorBuilder: (_, e, st) => Container(
                                    width: 180,
                                    color: SproutColors.pageBg,
                                    child: const Icon(
                                        Icons.image_not_supported))),
                          ),
                        );
                      },
                    ),
                  ),
                ],

                // Status update
                const SizedBox(height: 20),
                const Text('Update Status',
                    style: TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    _statusBtn(context, 'open', 'Open', status),
                    _statusBtn(
                        context, 'in_progress', 'In Progress', status),
                    _statusBtn(context, 'resolved', 'Resolved', status),
                  ],
                ),

                // History
                if (history.isNotEmpty) ...[
                  const SizedBox(height: 20),
                  Text('History (${history.length})',
                      style: const TextStyle(
                          fontWeight: FontWeight.w600, fontSize: 14)),
                  const SizedBox(height: 8),
                  ...history.map((h) {
                    final m = Map<String, dynamic>.from(h as Map);
                    final from = m['previous_status'] as String? ?? '';
                    final to = m['new_status'] as String? ?? '';
                    final p = m['profiles'] as Map?;
                    final name = p?['full_name'] as String? ?? 'System';
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 6),
                      child: Text('$name: $from → $to',
                          style: Theme.of(context).textTheme.bodySmall),
                    );
                  }),
                ],

                // Comments
                const SizedBox(height: 20),
                Text('Comments (${comments.length})',
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 14)),
                const SizedBox(height: 8),
                if (comments.isEmpty)
                  Text('No comments yet.',
                      style: Theme.of(context).textTheme.bodySmall),
                ...comments.map((c) {
                  final m = Map<String, dynamic>.from(c as Map);
                  final body = m['body'] as String? ?? '';
                  final p = m['profiles'] as Map?;
                  final name = p?['full_name'] as String? ?? 'Unknown';
                  final cAt = m['created_at'] as String?;
                  final cDt = cAt != null
                      ? DateTime.tryParse(cAt)?.toLocal()
                      : null;
                  final cTime = cDt != null
                      ? DateFormat('MMM d, h:mm a').format(cDt)
                      : '';
                  return Container(
                    margin: const EdgeInsets.only(bottom: 8),
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
                          mainAxisAlignment:
                              MainAxisAlignment.spaceBetween,
                          children: [
                            Text(name,
                                style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                    fontSize: 13)),
                            Text(cTime,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(body),
                      ],
                    ),
                  );
                }),
              ],
            ),
          ),

          // Comment input
          Container(
            padding: EdgeInsets.only(
              left: 12, right: 8, top: 8,
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
                    controller: _commentCtrl,
                    decoration: const InputDecoration(
                      hintText: 'Add a comment...',
                      border: InputBorder.none,
                      isDense: true,
                      contentPadding: EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                    ),
                    textInputAction: TextInputAction.send,
                    onSubmitted: (_) => _sendComment(),
                  ),
                ),
                _sending
                    ? const Padding(
                        padding: EdgeInsets.all(8),
                        child: SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                                strokeWidth: 2)),
                      )
                    : IconButton(
                        icon: const Icon(Icons.send,
                            color: SproutColors.green),
                        onPressed: _sendComment,
                      ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _sendComment() async {
    final body = _commentCtrl.text.trim();
    if (body.isEmpty) return;
    setState(() => _sending = true);
    try {
      final repo = ref.read(issuesRepositoryProvider);
      await repo.addComment(widget.issueId, body);
      _commentCtrl.clear();
      ref.invalidate(_issueDetailProvider(widget.issueId));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Widget _statusBtn(
      BuildContext context, String value, String label, String current) {
    final isActive = current == value;
    return ChoiceChip(
      label: Text(label),
      selected: isActive,
      selectedColor: SproutColors.green.withValues(alpha: 0.15),
      onSelected: isActive
          ? null
          : (_) async {
              try {
                final repo = ref.read(issuesRepositoryProvider);
                await repo.updateStatus(widget.issueId, value);
                ref.invalidate(_issueDetailProvider(widget.issueId));
                ref.read(myIssuesProvider.notifier).refresh();
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Failed: $e')),
                  );
                }
              }
            },
    );
  }

  Widget _pill(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(label,
          style: TextStyle(
              color: color, fontSize: 12, fontWeight: FontWeight.w500)),
    );
  }

  Widget _meta(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(children: [
        Icon(icon, size: 15, color: SproutColors.bodyText),
        const SizedBox(width: 6),
        Expanded(
            child: Text(text,
                style: const TextStyle(fontSize: 13),
                overflow: TextOverflow.ellipsis)),
      ]),
    );
  }

  String _statusLabel(String s) {
    switch (s) {
      case 'open': return 'Open';
      case 'in_progress': return 'In Progress';
      case 'pending_vendor': return 'Pending Vendor';
      case 'resolved': return 'Resolved';
      case 'verified_closed': return 'Closed';
      default: return s;
    }
  }

  Color _statusColor(String s) {
    switch (s) {
      case 'open': return SproutColors.cyan;
      case 'in_progress': return Colors.orange;
      case 'pending_vendor': return SproutColors.purple;
      case 'resolved': return SproutColors.green;
      case 'verified_closed': return Colors.grey;
      default: return SproutColors.bodyText;
    }
  }

  Color _priorityColor(String p) {
    switch (p) {
      case 'critical': return Colors.red;
      case 'high': return Colors.deepOrange;
      case 'medium': return Colors.orange;
      default: return Colors.green;
    }
  }
}
