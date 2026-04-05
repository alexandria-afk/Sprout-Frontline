/// A task assigned to the current user (GET /api/v1/tasks/my).
class Task {
  final String id;
  final String title;
  final String? description;
  final String priority; // low, medium, high, critical
  final String status; // open, in_progress, completed, blocked
  final String? dueAt;
  final String? locationName;
  final String sourceType; // manual, form, audit, cap, incident, workflow
  final String createdAt;

  const Task({
    required this.id,
    required this.title,
    this.description,
    required this.priority,
    required this.status,
    this.dueAt,
    this.locationName,
    required this.sourceType,
    required this.createdAt,
  });

  factory Task.fromJson(Map<String, dynamic> json) {
    final locName = json['location_name'] as String? ??
        (json['locations'] is Map
            ? (json['locations'] as Map)['name'] as String?
            : null);
    return Task(
      id: json['id'] as String,
      title: (json['title'] as String?) ?? 'Untitled',
      description: json['description'] as String?,
      priority: (json['priority'] as String?) ?? 'medium',
      status: (json['status'] as String?) ?? 'pending',
      dueAt: json['due_at'] as String?,
      locationName: locName,
      sourceType: (json['source_type'] as String?) ?? 'manual',
      createdAt: (json['created_at'] as String?) ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'description': description,
        'priority': priority,
        'status': status,
        'due_at': dueAt,
        'location_name': locationName,
        'source_type': sourceType,
        'created_at': createdAt,
      };

  bool get isOverdue {
    if (dueAt == null) return false;
    if (status == 'completed') return false;
    final due = DateTime.tryParse(dueAt!);
    return due != null && due.isBefore(DateTime.now());
  }
}

/// A message on a task thread.
class TaskMessage {
  final String id;
  final String body;
  final String userId;
  final String? userName;
  final String createdAt;

  const TaskMessage({
    required this.id,
    required this.body,
    required this.userId,
    this.userName,
    required this.createdAt,
  });

  factory TaskMessage.fromJson(Map<String, dynamic> json) {
    final profileName = json['profiles'] is Map
        ? (json['profiles'] as Map)['full_name'] as String?
        : null;
    return TaskMessage(
      id: json['id'] as String,
      body: (json['body'] as String?) ?? '',
      userId: json['user_id'] as String,
      userName: profileName ?? (json['user_name'] as String?),
      createdAt: (json['created_at'] as String?) ?? '',
    );
  }
}

/// Full task detail (GET /api/v1/tasks/{id}).
class TaskDetail {
  final Task task;
  final List<TaskMessage> messages;
  final List<Map<String, dynamic>> statusHistory;

  const TaskDetail({
    required this.task,
    required this.messages,
    this.statusHistory = const [],
  });

  factory TaskDetail.fromJson(Map<String, dynamic> json) {
    final rawMessages = json['task_messages'] as List? ?? [];
    final rawHistory = json['task_status_history'] as List? ?? [];
    return TaskDetail(
      task: Task.fromJson(json),
      messages: rawMessages
          .map((e) => Map<String, dynamic>.from(e as Map)).toList()
          .map(TaskMessage.fromJson)
          .toList(),
      statusHistory: rawHistory.map((e) => Map<String, dynamic>.from(e as Map)).toList(),
    );
  }
}
