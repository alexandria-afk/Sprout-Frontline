import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/badges/data/models/badge_models.dart';
import 'package:frontline_app/features/badges/providers/badges_provider.dart';

class BadgesScreen extends ConsumerWidget {
  const BadgesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Badges & Points'),
          bottom: const TabBar(
            indicatorColor: SproutColors.green,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white60,
            tabs: [
              Tab(text: 'My Badges'),
              Tab(text: 'Leaderboard'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _BadgesTab(),
            _LeaderboardTab(),
          ],
        ),
      ),
    );
  }
}

// ── Badges tab ────────────────────────────────────────────────────────────────

class _BadgesTab extends ConsumerWidget {
  const _BadgesTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncPoints = ref.watch(myPointsProvider);
    final asyncBadges = ref.watch(myBadgesProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(myPointsProvider);
        ref.invalidate(myBadgesProvider);
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Points card
          asyncPoints.when(
            loading: () => const SizedBox(
                height: 80,
                child: Center(child: CircularProgressIndicator())),
            error: (e, st) => const SizedBox.shrink(),
            data: (points) => _PointsCard(points: points),
          ),
          const SizedBox(height: 20),
          Text('Earned Badges',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          asyncBadges.when(
            loading: () =>
                const Center(child: CircularProgressIndicator()),
            error: (err, _) => Text('Could not load badges: $err',
                style: const TextStyle(color: Colors.red)),
            data: (badges) {
              if (badges.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      children: [
                        const Icon(Icons.military_tech_outlined,
                            size: 48, color: SproutColors.border),
                        const SizedBox(height: 12),
                        Text('No badges earned yet',
                            style:
                                Theme.of(context).textTheme.bodyMedium),
                      ],
                    ),
                  ),
                );
              }
              return Wrap(
                spacing: 12,
                runSpacing: 12,
                children:
                    badges.map((b) => _BadgeCard(badge: b)).toList(),
              );
            },
          ),
        ],
      ),
    );
  }
}

class _PointsCard extends StatelessWidget {
  final PointsSummary points;
  const _PointsCard({required this.points});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [SproutColors.cyan, SproutColors.cyanLight],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          const Icon(Icons.stars, size: 40, color: Colors.white),
          const SizedBox(width: 16),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                points.totalPoints.round().toString(),
                style: const TextStyle(
                    color: Colors.white,
                    fontSize: 32,
                    fontWeight: FontWeight.bold),
              ),
              const Text('Total Points',
                  style: TextStyle(color: Colors.white70, fontSize: 14)),
            ],
          ),
        ],
      ),
    );
  }
}

class _BadgeCard extends StatelessWidget {
  final EarnedBadge badge;
  const _BadgeCard({required this.badge});

  @override
  Widget build(BuildContext context) {
    final dt = DateTime.tryParse(badge.awardedAt)?.toLocal();
    final dateStr =
        dt != null ? DateFormat('MMM d, y').format(dt) : '';

    return Container(
      width: (MediaQuery.of(context).size.width - 44) / 2,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: SproutColors.cardBg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: SproutColors.border),
      ),
      child: Column(
        children: [
          // Icon/emoji
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: SproutColors.purple.withValues(alpha: 0.1),
              shape: BoxShape.circle,
            ),
            child: Center(
              child: badge.icon != null && badge.icon!.isNotEmpty
                  ? Text(badge.icon!,
                      style: const TextStyle(fontSize: 24))
                  : const Icon(Icons.military_tech,
                      color: SproutColors.purple),
            ),
          ),
          const SizedBox(height: 8),
          Text(badge.name,
              style: const TextStyle(
                  fontWeight: FontWeight.w600, fontSize: 13),
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis),
          if (badge.pointsAwarded > 0) ...[
            const SizedBox(height: 2),
            Text('+${badge.pointsAwarded} pts',
                style: const TextStyle(
                    color: SproutColors.green,
                    fontSize: 11,
                    fontWeight: FontWeight.w500)),
          ],
          const SizedBox(height: 4),
          Text(dateStr,
              style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

// ── Leaderboard tab ───────────────────────────────────────────────────────────

class _LeaderboardTab extends ConsumerStatefulWidget {
  const _LeaderboardTab();

  @override
  ConsumerState<_LeaderboardTab> createState() => _LeaderboardTabState();
}

class _LeaderboardTabState extends ConsumerState<_LeaderboardTab> {
  String? _selectedBoardId;

  @override
  Widget build(BuildContext context) {
    final asyncConfigs = ref.watch(leaderboardConfigsProvider);

    return asyncConfigs.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Could not load leaderboards',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () => ref.invalidate(leaderboardConfigsProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (configs) {
        if (configs.isEmpty) {
          return const Center(child: Text('No leaderboards configured.'));
        }
        // Auto-select first board.
        final selectedId = _selectedBoardId ?? configs.first.id;
        return Column(
          children: [
            // Board picker pills
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                children: configs.map((c) {
                  final isActive = c.id == selectedId;
                  return Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: GestureDetector(
                      onTap: () => setState(() => _selectedBoardId = c.id),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 12, vertical: 6),
                        decoration: BoxDecoration(
                          color: isActive
                              ? SproutColors.green.withValues(alpha: 0.15)
                              : SproutColors.pageBg,
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: isActive
                                ? SproutColors.green.withValues(alpha: 0.4)
                                : SproutColors.border,
                          ),
                        ),
                        child: Text(c.name,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: isActive
                                  ? FontWeight.w600
                                  : FontWeight.normal,
                              color: isActive
                                  ? SproutColors.green
                                  : SproutColors.bodyText,
                            )),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ),
            // Entries
            Expanded(child: _LeaderboardEntries(boardId: selectedId)),
          ],
        );
      },
    );
  }
}

class _LeaderboardEntries extends ConsumerWidget {
  final String boardId;
  const _LeaderboardEntries({required this.boardId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncEntries = ref.watch(leaderboardEntriesProvider(boardId));

    return asyncEntries.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, st) =>
          const Center(child: Text('Failed to load entries')),
      data: (entries) {
        if (entries.isEmpty) {
          return const Center(child: Text('No entries yet.'));
        }
        return RefreshIndicator(
          onRefresh: () async =>
              ref.invalidate(leaderboardEntriesProvider(boardId)),
          child: ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: entries.length,
            itemBuilder: (_, i) => _LeaderboardRow(entry: entries[i]),
          ),
        );
      },
    );
  }
}

class _LeaderboardRow extends StatelessWidget {
  final LeaderboardEntry entry;
  const _LeaderboardRow({required this.entry});

  @override
  Widget build(BuildContext context) {
    final isTop3 = entry.rank <= 3;
    final rankColor = entry.rank == 1
        ? Colors.amber
        : entry.rank == 2
            ? Colors.grey.shade400
            : entry.rank == 3
                ? Colors.brown.shade300
                : SproutColors.bodyText;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isTop3
            ? rankColor.withValues(alpha: 0.06)
            : SproutColors.cardBg,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
            color: isTop3
                ? rankColor.withValues(alpha: 0.3)
                : SproutColors.border),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 32,
            child: isTop3
                ? Icon(Icons.emoji_events, color: rankColor, size: 22)
                : Text('#${entry.rank}',
                    style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: SproutColors.bodyText)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(entry.userName,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 14)),
                if (entry.role != null)
                  Text(entry.role!,
                      style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          Text('${entry.score.round()}',
              style: TextStyle(
                  fontWeight: FontWeight.bold,
                  fontSize: 16,
                  color: isTop3 ? rankColor : SproutColors.darkText)),
        ],
      ),
    );
  }
}
