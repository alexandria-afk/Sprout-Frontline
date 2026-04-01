import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/badges/data/models/badge_models.dart';
import 'package:frontline_app/features/badges/data/repositories/badges_repository.dart';

final badgesRepositoryProvider = Provider<BadgesRepository>(
  (_) => BadgesRepository(),
);

final myPointsProvider = FutureProvider<PointsSummary>((ref) async {
  final repo = ref.read(badgesRepositoryProvider);
  return repo.getMyPoints();
});

final myBadgesProvider = FutureProvider<List<EarnedBadge>>((ref) async {
  final repo = ref.read(badgesRepositoryProvider);
  return repo.getMyBadges();
});

final leaderboardConfigsProvider =
    FutureProvider<List<LeaderboardConfig>>((ref) async {
  final repo = ref.read(badgesRepositoryProvider);
  return repo.getLeaderboards();
});

final leaderboardEntriesProvider =
    FutureProvider.family<List<LeaderboardEntry>, String>((ref, id) async {
  final repo = ref.read(badgesRepositoryProvider);
  return repo.getLeaderboardEntries(id);
});
