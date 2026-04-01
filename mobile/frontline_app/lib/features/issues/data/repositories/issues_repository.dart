import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/issues/data/models/issue_models.dart';

class IssuesRepository {
  /// Fetch current user's issues.
  Future<List<Issue>> getMyIssues() async {
    final response = await DioClient.instance
        .get('/api/v1/issues', queryParameters: {'my_issues': true});
    final data = response.data;
    // Response is { data: [...] } or bare list.
    final List items;
    if (data is Map && data['data'] is List) {
      items = data['data'] as List;
    } else if (data is List) {
      items = data;
    } else {
      return [];
    }
    return items
        .cast<Map<String, dynamic>>()
        .map(Issue.fromJson)
        .toList();
  }

  Future<List<IssueCategory>> getCategories() async {
    final response =
        await DioClient.instance.get('/api/v1/issues/categories');
    final data = response.data;
    // Response is { data: [...] } or bare list.
    final List items;
    if (data is Map && data['data'] is List) {
      items = data['data'] as List;
    } else if (data is List) {
      items = data;
    } else {
      return [];
    }
    return items
        .cast<Map<String, dynamic>>()
        .map(IssueCategory.fromJson)
        .toList();
  }

  /// Fetch full issue detail.
  Future<Map<String, dynamic>> getIssue(String issueId) async {
    final response =
        await DioClient.instance.get('/api/v1/issues/$issueId');
    return Map<String, dynamic>.from(response.data as Map);
  }

  /// Post a comment on an issue.
  Future<void> addComment(String issueId, String body) async {
    await DioClient.instance.post(
      '/api/v1/issues/$issueId/comments',
      data: {'body': body},
    );
  }

  /// Update issue status.
  Future<void> updateStatus(String issueId, String status,
      {String? note}) async {
    await DioClient.instance.put(
      '/api/v1/issues/$issueId/status',
      data: {'status': status, if (note != null) 'note': note},
    );
  }

  Future<IssueClassification> classifyIssue({
    required String title,
    required String description,
    required List<IssueCategory> categories,
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/ai/classify-issue',
      data: {
        'title': title,
        'description': description,
        'available_categories':
            categories.map((c) => {'id': c.id, 'name': c.name}).toList(),
      },
    );
    return IssueClassification.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  Future<Map<String, dynamic>> createIssue({
    required String title,
    required String description,
    required String categoryId,
    required String priority,
    bool isSafetyRisk = false,
    String? locationDescription,
    String? assetId,
    List<String> photoUrls = const [],
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/issues',
      data: {
        'title': title,
        'description': description,
        'category_id': categoryId,
        'priority': priority,
        'is_safety_risk': isSafetyRisk,
        if (locationDescription != null && locationDescription.isNotEmpty)
          'location_description': locationDescription,
        if (assetId != null && assetId.isNotEmpty)
          'asset_id': assetId,
      },
    );
    final issue = Map<String, dynamic>.from(response.data as Map);

    // Upload photos as attachments if any.
    final issueId = issue['id'] as String;
    for (final url in photoUrls) {
      await DioClient.instance.post(
        '/api/v1/issues/$issueId/attachments',
        data: {'file_url': url, 'file_type': 'image'},
      );
    }

    return issue;
  }
}
