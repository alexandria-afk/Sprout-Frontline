/// Category returned by GET /api/v1/issues/categories
class IssueCategory {
  final String id;
  final String name;
  final String? color;
  final int? slaHours;

  const IssueCategory({
    required this.id,
    required this.name,
    this.color,
    this.slaHours,
  });

  factory IssueCategory.fromJson(Map<String, dynamic> json) {
    return IssueCategory(
      id: json['id'] as String,
      name: (json['name'] as String?) ?? '',
      color: json['color'] as String?,
      slaHours: json['sla_hours'] as int?,
    );
  }
}

/// An issue reported by or assigned to the current user.
class Issue {
  final String id;
  final String title;
  final String? description;
  final String priority; // low, medium, high, critical
  final String status; // open, in_progress, pending_vendor, resolved, verified_closed
  final String? categoryName;
  final String? categoryColor;
  final String? locationName;
  final String? reportedByName;
  final String createdAt;

  const Issue({
    required this.id,
    required this.title,
    this.description,
    required this.priority,
    required this.status,
    this.categoryName,
    this.categoryColor,
    this.locationName,
    this.reportedByName,
    required this.createdAt,
  });

  factory Issue.fromJson(Map<String, dynamic> json) {
    final cat = json['issue_categories'] as Map?;
    final loc = json['locations'] as Map?;
    final profile = json['profiles'] as Map?;
    return Issue(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? 'Untitled',
      description: json['description'] as String?,
      priority: (json['priority'] as String?) ?? 'medium',
      status: (json['status'] as String?) ?? 'open',
      categoryName: cat?['name'] as String?,
      categoryColor: cat?['color'] as String?,
      locationName: loc?['name'] as String?,
      reportedByName: profile?['full_name'] as String?,
      createdAt: (json['created_at'] as String?) ?? '',
    );
  }
}

/// AI classification result from POST /api/v1/ai/classify-issue
class IssueClassification {
  final String type; // 'issue' | 'incident'
  final String? categoryId;
  final String priority; // low, medium, high, critical
  final String suggestedTitle;
  final bool isSafetyRisk;
  final String reasoning;

  const IssueClassification({
    required this.type,
    this.categoryId,
    required this.priority,
    required this.suggestedTitle,
    required this.isSafetyRisk,
    required this.reasoning,
  });

  factory IssueClassification.fromJson(Map<String, dynamic> json) {
    return IssueClassification(
      type: (json['type'] as String?) ?? 'issue',
      categoryId: json['category_id'] as String?,
      priority: (json['priority'] as String?) ?? 'medium',
      suggestedTitle: (json['suggested_title'] as String?) ?? '',
      isSafetyRisk: (json['is_safety_risk'] as bool?) ?? false,
      reasoning: (json['reasoning'] as String?) ?? '',
    );
  }
}
