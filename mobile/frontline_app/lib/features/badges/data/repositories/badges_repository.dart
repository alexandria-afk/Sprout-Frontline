import 'package:dio/dio.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/badges/data/models/badge_models.dart';

List<Map<String, dynamic>> _safeList(dynamic data) {
  List? raw;
  if (data is List) {
    raw = data;
  } else if (data is Map) {
    final items = data['items'] ?? data['data'];
    if (items is List) raw = items;
  }
  if (raw == null) return [];
  return raw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
}

class BadgesRepository {
  Future<PointsSummary> getMyPoints() async {
    try {
      final response =
          await DioClient.instance.get('/api/v1/gamification/points/my');
      return PointsSummary.fromJson(
          Map<String, dynamic>.from(response.data as Map));
    } on DioException catch (e) {
      final code = e.response?.statusCode;
      if (code == 404 || code == 500) {
        // Backend may 500 if points table has no row for user yet.
        return const PointsSummary(userId: '', totalPoints: 0);
      }
      rethrow;
    }
  }

  Future<List<EarnedBadge>> getMyBadges() async {
    final response =
        await DioClient.instance.get('/api/v1/gamification/badges/my');
    return _safeList(response.data).map(EarnedBadge.fromJson).toList();
  }

  /// Fetch all leaderboard configs.
  Future<List<LeaderboardConfig>> getLeaderboards() async {
    try {
      final response =
          await DioClient.instance.get('/api/v1/gamification/leaderboards');
      return _safeList(response.data).map(LeaderboardConfig.fromJson).toList();
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
            .map((e) => LeaderboardEntry.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return [];
    } catch (_) {
      return [];
    }
  }
}
