/// User's earned badge (GET /api/v1/gamification/badges/my).
class EarnedBadge {
  final String id;
  final String badgeId;
  final String name;
  final String? description;
  final String? icon;
  final int pointsAwarded;
  final String awardedAt;

  const EarnedBadge({
    required this.id,
    required this.badgeId,
    required this.name,
    this.description,
    this.icon,
    this.pointsAwarded = 0,
    required this.awardedAt,
  });

  factory EarnedBadge.fromJson(Map<String, dynamic> json) {
    // Badge details may be nested under badge_configs join.
    final badge = json['badge_configs'] as Map? ?? json;
    return EarnedBadge(
      id: json['id'] as String,
      badgeId: (json['badge_id'] as String?) ?? json['id'] as String,
      name: (badge['name'] as String?) ?? 'Badge',
      description: badge['description'] as String?,
      icon: badge['icon'] as String?,
      pointsAwarded: (badge['points_awarded'] as int?) ?? 0,
      awardedAt: (json['awarded_at'] as String?) ?? '',
    );
  }
}

/// User's points total (GET /api/v1/gamification/points/my).
class PointsSummary {
  final String userId;
  final double totalPoints;

  const PointsSummary({required this.userId, required this.totalPoints});

  factory PointsSummary.fromJson(Map<String, dynamic> json) {
    return PointsSummary(
      userId: json['user_id'] as String,
      totalPoints: (json['total_points'] as num?)?.toDouble() ?? 0,
    );
  }
}

/// A leaderboard config (GET /api/v1/gamification/leaderboards).
class LeaderboardConfig {
  final String id;
  final String name;
  final String? description;
  final String metricType;

  const LeaderboardConfig({
    required this.id,
    required this.name,
    this.description,
    required this.metricType,
  });

  factory LeaderboardConfig.fromJson(Map<String, dynamic> json) {
    return LeaderboardConfig(
      id: (json['id'] as String?) ?? '',
      name: (json['name'] as String?) ?? 'Leaderboard',
      description: json['description'] as String?,
      metricType: (json['metric_type'] as String?) ?? '',
    );
  }
}

/// An entry within a leaderboard.
class LeaderboardEntry {
  final String userId;
  final String userName;
  final String? role;
  final double score;
  final int rank;

  const LeaderboardEntry({
    required this.userId,
    required this.userName,
    this.role,
    required this.score,
    this.rank = 0,
  });

  factory LeaderboardEntry.fromJson(Map<String, dynamic> json) {
    return LeaderboardEntry(
      userId: (json['user_id'] as String?) ?? '',
      userName: (json['full_name'] as String?) ?? 'Unknown',
      role: json['role'] as String?,
      score: (json['score'] as num?)?.toDouble() ?? 0,
      rank: (json['rank'] as int?) ?? 0,
    );
  }
}
