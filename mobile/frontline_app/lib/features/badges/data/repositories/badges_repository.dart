import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/badges/data/models/badge_models.dart';

class BadgesRepository {
  Future<PointsSummary> getMyPoints() async {
    try {
      final response =
          await DioClient.instance.get('/api/v1/gamification/points/my');
      return PointsSummary.fromJson(
          Map<String, dynamic>.from(response.data as Map));
    } catch (_) {
      // Backend may 500 if points table has no row for user yet.
      return const PointsSummary(userId: '', totalPoints: 0);
    }
  }

  Future<List<EarnedBadge>> getMyBadges() async {
    final response =
        await DioClient.instance.get('/api/v1/gamification/badges/my');
    final data = response.data;
    if (data is List) {
      return data
          .cast<Map<String, dynamic>>()
          .map(EarnedBadge.fromJson)
          .toList();
    }
    return [];
  }

  /// Fetch all leaderboard configs.
  Future<List<LeaderboardConfig>> getLeaderboards() async {
    try {
      final response =
          await DioClient.instance.get('/api/v1/gamification/leaderboards');
      final data = response.data;
      final List items;
      if (data is Map) {
        items = (data['items'] ?? data['data'] ?? []) as List;
      } else if (data is List) {
        items = data;
      } else {
        return [];
      }
      return items
          .cast<Map<String, dynamic>>()
          .map(LeaderboardConfig.fromJson)
          .toList();
    } catch (_) {
      return [];
    }
  }

  /// Fetch entries for a specific leaderboard.
  Future<List<LeaderboardEntry>> getLeaderboardEntries(
      String leaderboardId) async {
    try {
      final response = await DioClient.instance
          .get('/api/v1/gamification/leaderboards/$leaderboardId');
      final data = response.data;
      if (data is Map && data['entries'] is List) {
        return (data['entries'] as List)
            .cast<Map<String, dynamic>>()
            .map(LeaderboardEntry.fromJson)
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }
}
