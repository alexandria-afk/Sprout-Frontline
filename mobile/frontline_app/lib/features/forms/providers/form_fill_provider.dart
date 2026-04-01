import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/offline/hive_service.dart';
import 'package:frontline_app/features/forms/data/models/form_template.dart';
import 'package:frontline_app/features/forms/data/models/form_draft.dart';
import 'package:frontline_app/features/forms/data/repositories/form_fill_repository.dart';

final formFillRepositoryProvider = Provider<FormFillRepository>(
  (_) => FormFillRepository(),
);

/// State for the form fill screen — holds both the template and current values.
class FormFillState {
  final FormTemplate template;
  final Map<String, dynamic> values;
  final String? draftId;
  final bool isSaving;
  final bool isSubmitting;
  final String? error;

  const FormFillState({
    required this.template,
    required this.values,
    this.draftId,
    this.isSaving = false,
    this.isSubmitting = false,
    this.error,
  });

  FormFillState copyWith({
    FormTemplate? template,
    Map<String, dynamic>? values,
    String? draftId,
    bool? isSaving,
    bool? isSubmitting,
    String? error,
  }) {
    return FormFillState(
      template: template ?? this.template,
      values: values ?? this.values,
      draftId: draftId ?? this.draftId,
      isSaving: isSaving ?? this.isSaving,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      error: error,
    );
  }
}

/// Manages form fill state for a given assignment ID.
/// Loads template + draft on init, supports field updates, save draft, submit.
final formFillProvider = AsyncNotifierProvider.family<
    FormFillNotifier, FormFillState, String>(
  FormFillNotifier.new,
);

class FormFillNotifier extends FamilyAsyncNotifier<FormFillState, String> {
  @override
  Future<FormFillState> build(String arg) async {
    return _load(arg);
  }

  Future<FormFillState> _load(String assignmentId) async {
    final repo = ref.read(formFillRepositoryProvider);

    // Load template and draft in parallel.
    final results = await Future.wait([
      repo.getTemplate(assignmentId),
      repo.getDraft(assignmentId),
    ]);

    final template = results[0] as FormTemplate;
    final draft = results[1] as FormDraft?;

    final formState = FormFillState(
      template: template,
      values: draft?.values ?? {},
      draftId: draft?.id,
    );

    // Cache for offline access.
    _toCache(assignmentId, formState);

    return formState;
  }

  /// Update a single field value.
  void updateField(String fieldId, dynamic value) {
    final current = state.valueOrNull;
    if (current == null) return;
    final newValues = Map<String, dynamic>.from(current.values);
    newValues[fieldId] = value;
    state = AsyncData(current.copyWith(values: newValues));
  }

  /// Save current values as a draft.
  Future<bool> saveDraft() async {
    final current = state.valueOrNull;
    if (current == null) return false;

    state = AsyncData(current.copyWith(isSaving: true, error: null));

    try {
      final repo = ref.read(formFillRepositoryProvider);
      final result = await repo.submitForm(
        assignmentId: arg,
        values: current.values,
        status: 'draft',
      );
      state = AsyncData(current.copyWith(
        isSaving: false,
        draftId: result.id,
      ));
      // Also save to pending_submissions for offline sync.
      _savePending(arg, current.values, 'draft');
      return true;
    } catch (e) {
      // Save locally for offline sync even if API fails.
      _savePending(arg, current.values, 'draft');
      state = AsyncData(current.copyWith(
        isSaving: false,
        error: 'Saved offline. Will sync when connected.',
      ));
      return false;
    }
  }

  /// Submit the form (final submission).
  Future<bool> submit() async {
    final current = state.valueOrNull;
    if (current == null) return false;

    state = AsyncData(current.copyWith(isSubmitting: true, error: null));

    try {
      final repo = ref.read(formFillRepositoryProvider);
      await repo.submitForm(
        assignmentId: arg,
        values: current.values,
        status: 'submitted',
      );
      state = AsyncData(current.copyWith(isSubmitting: false));
      return true;
    } catch (e) {
      // Queue for offline sync.
      _savePending(arg, current.values, 'submitted');
      state = AsyncData(current.copyWith(
        isSubmitting: false,
        error: 'Queued for submission. Will sync when connected.',
      ));
      return false;
    }
  }

  // ── Cache helpers ──────────────────────────────────────────────────────────

  void _toCache(String assignmentId, FormFillState formState) {
    final box = HiveService.formsCache;
    box.put('fill_$assignmentId', {
      'template': {
        'id': formState.template.id,
        'title': formState.template.title,
        'description': formState.template.description,
        'type': formState.template.type,
        'fields': formState.template.fields
            .map((f) => {
                  'id': f.id,
                  'label': f.label,
                  'type': f.type,
                  'required': f.required,
                  'placeholder': f.placeholder,
                  'options': f.options,
                  if (f.conditionalLogic != null)
                    'conditional_logic': {
                      'depends_on': f.conditionalLogic!.dependsOn,
                      'operator': f.conditionalLogic!.operator,
                      'value': f.conditionalLogic!.value,
                    },
                })
            .toList(),
      },
      'values': formState.values,
      'draft_id': formState.draftId,
    });
  }

  void _savePending(
      String assignmentId, Map<String, dynamic> values, String status) {
    final box = HiveService.pendingSubmissions;
    box.put(assignmentId, {
      'assignment_id': assignmentId,
      'values': values,
      'status': status,
      'queued_at': DateTime.now().toIso8601String(),
    });
  }
}
