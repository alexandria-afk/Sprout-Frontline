/// Represents a saved draft or submitted form.
/// Used for both GET /forms/assignments/{id}/draft responses
/// and POST /forms/submissions request bodies.
class FormDraft {
  final String? id;
  final String assignmentId;
  final Map<String, dynamic> values;
  final String status; // 'draft' | 'submitted'
  final String? updatedAt;

  const FormDraft({
    this.id,
    required this.assignmentId,
    required this.values,
    required this.status,
    this.updatedAt,
  });

  factory FormDraft.fromJson(Map<String, dynamic> json) {
    return FormDraft(
      id: json['id'] as String?,
      assignmentId: (json['assignment_id'] as String?) ?? '',
      values: Map<String, dynamic>.from(json['values'] as Map? ?? {}),
      status: (json['status'] as String?) ?? 'draft',
      updatedAt: json['updated_at'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        if (id != null) 'id': id,
        'assignment_id': assignmentId,
        'values': values,
        'status': status,
      };
}
