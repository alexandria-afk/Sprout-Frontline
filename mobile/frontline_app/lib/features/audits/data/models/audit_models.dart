/// An audit template (GET /api/v1/audits/templates).
class AuditTemplate {
  final String id;
  final String title;
  final String? description;
  final double passingScore;
  final List<AuditSection> sections;
  final Map<String, double> fieldScores; // fieldId → maxScore

  const AuditTemplate({
    required this.id,
    required this.title,
    this.description,
    this.passingScore = 80,
    this.sections = const [],
    this.fieldScores = const {},
  });

  factory AuditTemplate.fromJson(Map<String, dynamic> json) {
    final rawSections = json['form_sections'] as List? ??
        json['sections'] as List? ??
        [];
    // Build field score map from audit_field_scores or field_scores.
    final rawScores = json['audit_field_scores'] as List? ??
        json['field_scores'] as List? ??
        [];
    final scoreMap = <String, double>{};
    for (final s in rawScores) {
      final m = Map<String, dynamic>.from(s as Map);
      scoreMap[m['field_id'] as String] =
          (m['max_score'] as num?)?.toDouble() ?? 1.0;
    }

    return AuditTemplate(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? 'Untitled',
      description: json['description'] as String?,
      passingScore:
          (json['passing_score'] as num?)?.toDouble() ?? 80,
      sections: rawSections
          .cast<Map<String, dynamic>>()
          .map(AuditSection.fromJson)
          .toList()
        ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder)),
      fieldScores: scoreMap,
    );
  }
}

/// A section within an audit template.
class AuditSection {
  final String id;
  final String title;
  final int displayOrder;
  final List<AuditField> fields;

  const AuditSection({
    required this.id,
    required this.title,
    this.displayOrder = 0,
    this.fields = const [],
  });

  factory AuditSection.fromJson(Map<String, dynamic> json) {
    final rawFields = json['form_fields'] as List? ??
        json['fields'] as List? ??
        [];
    return AuditSection(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? '',
      displayOrder: (json['display_order'] as int?) ?? 0,
      fields: rawFields
          .cast<Map<String, dynamic>>()
          .map(AuditField.fromJson)
          .toList()
        ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder)),
    );
  }
}

/// A scorable field within an audit section.
class AuditField {
  final String id;
  final String label;
  final String fieldType; // checkbox, text, number, photo, dropdown
  final bool isRequired;
  final bool isCritical;
  final List<String> options;
  final int displayOrder;
  final String? placeholder;

  const AuditField({
    required this.id,
    required this.label,
    required this.fieldType,
    this.isRequired = false,
    this.isCritical = false,
    this.options = const [],
    this.displayOrder = 0,
    this.placeholder,
  });

  factory AuditField.fromJson(Map<String, dynamic> json) {
    final rawOpts = json['options'] as List?;
    return AuditField(
      id: json['id'] as String,
      label: (json['label'] as String?) ?? '',
      fieldType: (json['field_type'] as String?) ?? 'text',
      isRequired: (json['is_required'] as bool?) ?? false,
      isCritical: (json['is_critical'] as bool?) ?? false,
      options: rawOpts?.map((e) => e.toString()).toList() ?? [],
      displayOrder: (json['display_order'] as int?) ?? 0,
      placeholder: json['placeholder'] as String?,
    );
  }
}

/// Result returned by POST /api/v1/audits/submissions.
class AuditSubmissionResult {
  final String id;
  final double overallScore;
  final bool passed;
  final double passingScore;
  final String? capId;

  const AuditSubmissionResult({
    required this.id,
    required this.overallScore,
    required this.passed,
    required this.passingScore,
    this.capId,
  });

  factory AuditSubmissionResult.fromJson(Map<String, dynamic> json) {
    return AuditSubmissionResult(
      id: json['id'] as String,
      overallScore: (json['overall_score'] as num?)?.toDouble() ?? 0,
      passed: (json['passed'] as bool?) ?? false,
      passingScore: (json['passing_score'] as num?)?.toDouble() ?? 80,
      capId: json['cap_id'] as String?,
    );
  }
}
