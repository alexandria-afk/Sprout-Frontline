import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/features/audits/data/models/audit_models.dart';

class AuditsRepository {
  Future<List<AuditTemplate>> getTemplates() async {
    final response =
        await DioClient.instance.get('/api/v1/audits/templates');
    final data = response.data;
    if (data is List) {
      return data
          .cast<Map<String, dynamic>>()
          .map(AuditTemplate.fromJson)
          .toList();
    }
    return [];
  }

  Future<AuditTemplate> getTemplate(String templateId) async {
    final response = await DioClient.instance
        .get('/api/v1/audits/templates/$templateId');
    return AuditTemplate.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  Future<AuditSubmissionResult> submitAudit({
    required String templateId,
    required String locationId,
    required List<Map<String, dynamic>> responses,
  }) async {
    final response = await DioClient.instance.post(
      '/api/v1/audits/submissions',
      data: {
        'form_template_id': templateId,
        'location_id': locationId,
        'responses': responses,
      },
    );
    return AuditSubmissionResult.fromJson(
        Map<String, dynamic>.from(response.data as Map));
  }

  Future<void> captureSignature({
    required String submissionId,
    required String signatureDataUrl,
  }) async {
    await DioClient.instance.post(
      '/api/v1/audits/submissions/$submissionId/signature',
      data: {'signature_data_url': signatureDataUrl},
    );
  }
}
