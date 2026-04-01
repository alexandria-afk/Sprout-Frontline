/// Represents a single form/checklist assignment returned by
/// GET /api/v1/forms/assignments/my
class FormAssignment {
  final String id;
  final String templateId;
  final String templateTitle;
  final String templateType; // 'checklist' | 'form'
  final String? templateDescription;
  final String? dueAt;
  final String recurrence; // 'once' | 'daily' | 'weekly' | 'custom'
  final bool isActive;
  final bool completed;

  const FormAssignment({
    required this.id,
    required this.templateId,
    required this.templateTitle,
    required this.templateType,
    this.templateDescription,
    this.dueAt,
    required this.recurrence,
    required this.isActive,
    this.completed = false,
  });

  bool get isOverdue {
    if (completed) return false;
    if (dueAt == null) return false;
    final due = DateTime.tryParse(dueAt!);
    return due != null && due.isBefore(DateTime.now());
  }

  factory FormAssignment.fromJson(Map<String, dynamic> json) {
    // API nests template info under form_templates join.
    final rawTpl = json['form_templates'];
    final tpl = rawTpl is Map ? Map<String, dynamic>.from(rawTpl) : <String, dynamic>{};
    return FormAssignment(
      id: (json['id'] as String?) ?? '',
      templateId: (json['form_template_id'] as String?) ??
          (json['template_id'] as String?) ??
          '',
      templateTitle: (tpl['title'] as String?) ??
          (json['template_title'] as String?) ??
          'Untitled',
      templateType: (tpl['type'] as String?) ??
          (json['template_type'] as String?) ??
          'form',
      templateDescription: (tpl['description'] as String?) ??
          (json['template_description'] as String?),
      dueAt: json['due_at'] as String?,
      recurrence: (json['recurrence'] as String?) ?? 'once',
      isActive: (json['is_active'] as bool?) ?? true,
      completed: (json['completed'] as bool?) ?? false,
    );
  }

  /// Serialise to raw Map for Hive Box<Map> storage.
  Map<String, dynamic> toJson() => {
        'id': id,
        'template_id': templateId,
        'template_title': templateTitle,
        'template_type': templateType,
        'template_description': templateDescription,
        'due_at': dueAt,
        'recurrence': recurrence,
        'is_active': isActive,
        'completed': completed,
      };
}
