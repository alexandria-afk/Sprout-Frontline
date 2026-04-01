import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/announcements/data/models/announcement.dart';
import 'package:frontline_app/features/announcements/providers/announcements_provider.dart';

class AnnouncementsScreen extends ConsumerWidget {
  const AnnouncementsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncAnnouncements = ref.watch(announcementsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Announcements'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () =>
                ref.read(announcementsProvider.notifier).refresh(),
          ),
        ],
      ),
      body: asyncAnnouncements.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.wifi_off_outlined,
                  size: 48, color: SproutColors.bodyText),
              const SizedBox(height: 16),
              Text('Could not load announcements',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.read(announcementsProvider.notifier).refresh(),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
        data: (announcements) {
          if (announcements.isEmpty) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.campaign_outlined,
                      size: 64, color: SproutColors.border),
                  const SizedBox(height: 16),
                  Text('No announcements',
                      style: Theme.of(context).textTheme.titleMedium),
                ],
              ),
            );
          }
          return RefreshIndicator(
            onRefresh: () =>
                ref.read(announcementsProvider.notifier).refresh(),
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: announcements.length,
              itemBuilder: (_, i) =>
                  _AnnouncementPost(announcement: announcements[i]),
            ),
          );
        },
      ),
    );
  }
}

// ── Social-media style post card ──────────────────────────────────────────────

class _AnnouncementPost extends ConsumerWidget {
  final Announcement announcement;
  const _AnnouncementPost({required this.announcement});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dt = DateTime.tryParse(announcement.createdAt)?.toLocal();
    final timeStr = dt != null ? _timeAgo(dt) : '';
    final allMedia = [
      if (announcement.mediaUrl != null) announcement.mediaUrl!,
      ...announcement.mediaUrls,
    ];

    // Mark as read on first render.
    if (!announcement.isRead) {
      Future.microtask(() =>
          ref.read(announcementsProvider.notifier).markRead(announcement.id));
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header — avatar, name, time
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 18,
                  backgroundColor: SproutColors.green.withValues(alpha: 0.12),
                  child: Text(
                    (announcement.creatorName ?? 'A')[0].toUpperCase(),
                    style: const TextStyle(
                        color: SproutColors.green,
                        fontWeight: FontWeight.w600),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        announcement.creatorName ?? 'Admin',
                        style: const TextStyle(
                            fontWeight: FontWeight.w600, fontSize: 14),
                      ),
                      Text(timeStr,
                          style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
                if (!announcement.isRead)
                  Container(
                    width: 8,
                    height: 8,
                    decoration: const BoxDecoration(
                      color: SproutColors.cyan,
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
          ),

          // Title
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Text(
              announcement.title,
              style: const TextStyle(
                  fontSize: 16, fontWeight: FontWeight.w600),
            ),
          ),

          // Body
          if (announcement.body.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
              child: Text(
                announcement.body,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),

          // Photos
          if (allMedia.isNotEmpty) ...[
            const SizedBox(height: 12),
            SizedBox(
              height: 200,
              child: allMedia.length == 1
                  ? Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.network(
                          allMedia.first,
                          width: double.infinity,
                          fit: BoxFit.cover,
                          errorBuilder: (_, e, st) => Container(
                            color: SproutColors.pageBg,
                            child: const Center(
                              child: Icon(Icons.image_not_supported,
                                  color: SproutColors.border),
                            ),
                          ),
                        ),
                      ),
                    )
                  : ListView.builder(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      itemCount: allMedia.length,
                      itemBuilder: (_, i) => Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(10),
                          child: Image.network(
                            allMedia[i],
                            width: 200,
                            fit: BoxFit.cover,
                            errorBuilder: (_, e, st) => Container(
                              width: 200,
                              color: SproutColors.pageBg,
                              child: const Center(
                                child: Icon(Icons.image_not_supported,
                                    color: SproutColors.border),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
            ),
          ],

          // Acknowledge button
          if (announcement.requiresAcknowledgement) ...[
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
              child: announcement.isAcknowledged
                  ? Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: SproutColors.green.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.check_circle,
                              size: 16, color: SproutColors.green),
                          SizedBox(width: 6),
                          Text('Acknowledged',
                              style: TextStyle(
                                  color: SproutColors.green,
                                  fontWeight: FontWeight.w500,
                                  fontSize: 13)),
                        ],
                      ),
                    )
                  : SizedBox(
                      width: double.infinity,
                      child: ElevatedButton(
                        onPressed: () => ref
                            .read(announcementsProvider.notifier)
                            .acknowledge(announcement.id),
                        style: ElevatedButton.styleFrom(
                          padding:
                              const EdgeInsets.symmetric(vertical: 12),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10)),
                        ),
                        child: const Text('Acknowledge'),
                      ),
                    ),
            ),
          ] else
            const SizedBox(height: 14),
        ],
      ),
    );
  }

  String _timeAgo(DateTime dt) {
    final diff = DateTime.now().difference(dt);
    if (diff.inDays > 7) return DateFormat('MMM d').format(dt);
    if (diff.inDays > 0) return '${diff.inDays}d ago';
    if (diff.inHours > 0) return '${diff.inHours}h ago';
    if (diff.inMinutes > 0) return '${diff.inMinutes}m ago';
    return 'Just now';
  }
}
