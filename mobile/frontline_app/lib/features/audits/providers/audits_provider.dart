import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/audits/data/models/audit_models.dart';
import 'package:frontline_app/features/audits/data/repositories/audits_repository.dart';

final auditsRepositoryProvider = Provider<AuditsRepository>(
  (_) => AuditsRepository(),
);

final auditTemplatesProvider =
    FutureProvider<List<AuditTemplate>>((ref) async {
  final repo = ref.read(auditsRepositoryProvider);
  return repo.getTemplates();
});

// ── Audit fill state ──────────────────────────────────────────────────────────

class AuditFillState {
  final AuditTemplate template;
  final Map<String, dynamic> values; // fieldId → value
  final Map<String, String?> comments; // fieldId → comment
  final String? locationId;
  final bool isSubmitting;
  final AuditSubmissionResult? result;
  final String? error;

  const AuditFillState({
    required this.template,
    this.values = const {},
    this.comments = const {},
    this.locationId,
    this.isSubmitting = false,
    this.result,
    this.error,
  });

  AuditFillState copyWith({
    AuditTemplate? template,
    Map<String, dynamic>? values,
    Map<String, String?>? comments,
    String? locationId,
    bool? isSubmitting,
    AuditSubmissionResult? result,
    String? error,
  }) {
    return AuditFillState(
      template: template ?? this.template,
      values: values ?? this.values,
      comments: comments ?? this.comments,
      locationId: locationId ?? this.locationId,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      result: result ?? this.result,
      error: error,
    );
  }
}

final auditFillProvider = AsyncNotifierProvider.family<
    AuditFillNotifier, AuditFillState, String>(
  AuditFillNotifier.new,
);

class AuditFillNotifier
    extends FamilyAsyncNotifier<AuditFillState, String> {
  @override
  Future<AuditFillState> build(String arg) async {
    final repo = ref.read(auditsRepositoryProvider);
    final template = await repo.getTemplate(arg);
    return AuditFillState(template: template);
  }

  void setFieldValue(String fieldId, dynamic value) {
    final s = state.valueOrNull;
    if (s == null) return;
    final updated = Map<String, dynamic>.from(s.values);
    updated[fieldId] = value;
    state = AsyncData(s.copyWith(values: updated));
  }

  void setFieldComment(String fieldId, String? comment) {
    final s = state.valueOrNull;
    if (s == null) return;
    final updated = Map<String, String?>.from(s.comments);
    updated[fieldId] = comment;
    state = AsyncData(s.copyWith(comments: updated));
  }

  void setLocationId(String locationId) {
    final s = state.valueOrNull;
    if (s == null) return;
    state = AsyncData(s.copyWith(locationId: locationId));
  }

  Future<AuditSubmissionResult?> submit() async {
    final s = state.valueOrNull;
    if (s == null || s.locationId == null) return null;

    state = AsyncData(s.copyWith(isSubmitting: true, error: null));

    try {
      final repo = ref.read(auditsRepositoryProvider);
      final responses = s.values.entries.map((e) {
        return {
          'field_id': e.key,
          'value': e.value.toString(),
          if (s.comments[e.key] != null) 'comment': s.comments[e.key],
        };
      }).toList();

      final result = await repo.submitAudit(
        templateId: arg,
        locationId: s.locationId!,
        responses: responses,
      );
      state = AsyncData(s.copyWith(
        isSubmitting: false,
        result: result,
      ));
      return result;
    } catch (e) {
      state = AsyncData(s.copyWith(
        isSubmitting: false,
        error: e.toString(),
      ));
      return null;
    }
  }

  Future<void> captureSignature(
      String submissionId, String dataUrl) async {
    final repo = ref.read(auditsRepositoryProvider);
    await repo.captureSignature(
      submissionId: submissionId,
      signatureDataUrl: dataUrl,
    );
  }
}
