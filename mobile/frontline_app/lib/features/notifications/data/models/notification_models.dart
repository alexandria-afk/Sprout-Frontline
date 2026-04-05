class AppNotification {
  final String id;
  final String type;
  final String title;
  final String? body;
  final String? entityType;
  final String? entityId;
  final bool isRead;
  final String createdAt;

  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    this.body,
    this.entityType,
    this.entityId,
    required this.isRead,
    required this.createdAt,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    return AppNotification(
      id: (json['id'] as String?) ?? '',
      type: (json['type'] as String?) ?? '',
      title: (json['title'] as String?) ?? '',
      body: json['body'] as String?,
      entityType: json['entity_type'] as String?,
      entityId: json['entity_id'] as String?,
      isRead: (json['is_read'] as bool?) ?? false,
      createdAt: (json['created_at'] as String?) ?? '',
    );
  }

  /// Route to navigate to when tapped.
  String get route {
    if (entityType == null || entityId == null) return '/dashboard';
    return switch (entityType) {
      'task' => '/tasks/$entityId',
      'form_assignment' => '/forms/fill/$entityId',
      'issue' => '/issues/$entityId',
      'announcement' => '/announcements',
      'course_enrollment' => '/training',
      'shift_claim' || 'shift_swap' => '/shifts',
      _ => '/dashboard',
    };
  }
}
