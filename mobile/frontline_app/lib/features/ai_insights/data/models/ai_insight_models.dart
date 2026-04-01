class AIInsightsResponse {
  final String brief;
  final List<AIInsight> insights;

  const AIInsightsResponse({
    required this.brief,
    required this.insights,
  });

  factory AIInsightsResponse.fromJson(Map<String, dynamic> json) {
    final rawInsights = json['insights'] as List? ?? [];
    return AIInsightsResponse(
      brief: (json['brief'] as String?) ?? '',
      insights: rawInsights
          .cast<Map<String, dynamic>>()
          .map(AIInsight.fromJson)
          .toList(),
    );
  }

  Map<String, dynamic> toJson() => {
        'brief': brief,
        'insights': insights.map((i) => i.toJson()).toList(),
      };
}

class AIInsight {
  final String severity; // critical, warning, info
  final String title;
  final String body;
  final String recommendation;

  const AIInsight({
    required this.severity,
    required this.title,
    required this.body,
    required this.recommendation,
  });

  factory AIInsight.fromJson(Map<String, dynamic> json) {
    return AIInsight(
      severity: (json['severity'] as String?) ?? 'info',
      title: (json['title'] as String?) ?? '',
      body: (json['body'] as String?) ?? '',
      recommendation: (json['recommendation'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'severity': severity,
        'title': title,
        'body': body,
        'recommendation': recommendation,
      };

  /// Unique key for dismiss tracking (stable per insight per day).
  String get dismissKey => '${severity}_${title.hashCode}';
}
