import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/forms/data/models/form_template.dart';
import 'package:frontline_app/features/forms/data/models/form_draft.dart';

class FormFillRepository {
  /// Load the template (field definitions) for a given assignment.
  Future<FormTemplate> getTemplate(String assignmentId) async {
    final response = await DioClient.instance
        .get('/api/v1/forms/assignments/$assignmentId/template');
    final data = response.data;
    if (data is! Map) throw FormatException('Invalid template response');
    return FormTemplate.fromJson(Map<String, dynamic>.from(data));
  }

  /// Load an existing draft for a given assignment, or null if none exists.
  Future<FormDraft?> getDraft(String assignmentId) async {
    try {
      final response = await DioClient.instance
          .get('/api/v1/forms/assignments/$assignmentId/draft');
      if (response.data == null) return null;
      return FormDraft.fromJson(
          Map<String, dynamic>.from(response.data as Map));
    } on Exception {
      // 404 means no draft — swallow it.
      return null;
    }
  }

  /// Create or update a submission (draft or final).
  Future<FormDraft> submitForm({
    required String assignmentId,
    required Map<String, dynamic> values,
    required String status, // 'draft' | 'submitted'
  }) async {
    final body = {
      'assignment_id': assignmentId,
      'values': values,
      'status': status,
    };
    final response = await DioClient.instance
        .post('/api/v1/forms/submissions', data: body);
    return FormDraft.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }
}
