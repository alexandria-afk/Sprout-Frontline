/// Status-based actionable items for the current user.
/// Powered by GET /api/v1/inbox — returns tasks, forms, workflows,
/// courses, announcements, and issues that still need attention.
class InboxItem {
  final String kind; // "task"|"form"|"workflow"|"course"|"announcement"|"issue"
  final String id;
  final String title;
  final String? description;
  final String? priority;
  final String? formType;
  final String? workflowInstanceId;
  final bool isMandatory;
  final DateTime? dueAt;
  final bool isOverdue;
  final DateTime createdAt;

  const InboxItem({
    required this.kind,
    required this.id,
    required this.title,
    this.description,
    this.priority,
    this.formType,
    this.workflowInstanceId,
    required this.isMandatory,
    this.dueAt,
    required this.isOverdue,
    required this.createdAt,
  });

  factory InboxItem.fromJson(Map<String, dynamic> json) {
    return InboxItem(
      kind: (json['kind'] as String?) ?? 'task',
      id: (json['id'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      description: json['description'] as String?,
      priority: json['priority'] as String?,
      formType: json['form_type'] as String?,
      workflowInstanceId: json['workflow_instance_id'] as String?,
      isMandatory: (json['is_mandatory'] as bool?) ?? false,
      dueAt: json['due_at'] != null ? DateTime.tryParse(json['due_at'] as String) : null,
      isOverdue: (json['is_overdue'] as bool?) ?? false,
      createdAt: DateTime.tryParse((json['created_at'] as String?) ?? '') ?? DateTime.now(),
    );
  }

  /// Navigation route for this item.
  String get route {
    switch (kind) {
      case 'task':         return '/tasks/$id';
      case 'form':         return '/forms/fill/$id';
      case 'workflow':
        return workflowInstanceId != null
            ? '/workflows/instances/$workflowInstanceId'
            : '/workflows';
      case 'course':       return '/training';
      case 'announcement': return '/announcements';
      case 'issue':        return '/issues/$id';
      // Manager / admin / super_admin action items — navigate to shifts or forms
      case 'shift_claim':   return '/shifts';
      case 'shift_swap':    return '/shifts';
      case 'leave_request': return '/shifts';
      case 'form_review':   return '/forms';
      case 'cap':           return '/forms';
      default:              return '/dashboard';
    }
  }
}
