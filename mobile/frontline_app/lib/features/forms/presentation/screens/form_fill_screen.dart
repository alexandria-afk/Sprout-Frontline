import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/forms/data/models/form_template.dart';
import 'package:frontline_app/features/forms/providers/form_fill_provider.dart';
import 'package:frontline_app/features/forms/presentation/widgets/form_fields.dart';

class FormFillScreen extends ConsumerWidget {
  final String assignmentId;
  const FormFillScreen({super.key, required this.assignmentId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncState = ref.watch(formFillProvider(assignmentId));

    return asyncState.when(
      loading: () => Scaffold(
        appBar: AppBar(
          title: const Text('Loading...'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/forms'),
          ),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (err, _) => Scaffold(
        appBar: AppBar(
          title: const Text('Error'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/forms'),
          ),
        ),
        body: _ErrorBody(
          message: err.toString(),
          onRetry: () => ref.invalidate(formFillProvider(assignmentId)),
        ),
      ),
      data: (formState) => _FormFillBody(
        assignmentId: assignmentId,
        formState: formState,
      ),
    );
  }
}

class _FormFillBody extends ConsumerWidget {
  final String assignmentId;
  final FormFillState formState;
  const _FormFillBody({
    required this.assignmentId,
    required this.formState,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final template = formState.template;
    final values = formState.values;

    // Filter visible fields based on conditional logic.
    final visibleFields = template.fields.where((f) {
      if (f.conditionalLogic == null) return true;
      return f.conditionalLogic!.evaluate(values);
    }).toList();

    // Validate required fields for submit button state.
    final allRequiredFilled = _allRequiredFilled(template.fields, values);

    return Scaffold(
      appBar: AppBar(
        title: Text(template.title),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => _onBack(context, ref),
        ),
      ),
      body: Column(
        children: [
          // Progress indicator
          _ProgressBar(
            filled: _filledCount(visibleFields, values),
            total: visibleFields.length,
          ),

          // Banner for errors / offline status
          if (formState.error != null)
            MaterialBanner(
              content: Text(formState.error!),
              backgroundColor: Colors.amber.shade50,
              leading: const Icon(Icons.cloud_off, color: Colors.amber),
              actions: [
                TextButton(
                  onPressed: () => ref
                      .read(formFillProvider(assignmentId).notifier)
                      .updateField('__clear_error', null),
                  child: const Text('DISMISS'),
                ),
              ],
            ),

          // Form fields
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: visibleFields.length,
              itemBuilder: (context, index) {
                final field = visibleFields[index];
                return FormFieldWidget(
                  fieldDef: field,
                  value: values[field.id],
                  onChanged: (v) => ref
                      .read(formFillProvider(assignmentId).notifier)
                      .updateField(field.id, v),
                );
              },
            ),
          ),

          // Bottom action bar
          _BottomBar(
            isSaving: formState.isSaving,
            isSubmitting: formState.isSubmitting,
            canSubmit: allRequiredFilled,
            onSaveDraft: () async {
              final notifier =
                  ref.read(formFillProvider(assignmentId).notifier);
              final ok = await notifier.saveDraft();
              if (context.mounted && ok) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Draft saved'),
                    backgroundColor: SproutColors.green,
                  ),
                );
              }
            },
            onSubmit: () => _confirmSubmit(context, ref),
          ),
        ],
      ),
    );
  }

  void _onBack(BuildContext context, WidgetRef ref) {
    // Prompt to save draft if there are unsaved values.
    if (formState.values.isNotEmpty && formState.draftId == null) {
      showDialog(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Unsaved changes'),
          content: const Text('Save as draft before leaving?'),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.pop(context); // close dialog
                context.go('/forms');
              },
              child: const Text('Discard'),
            ),
            ElevatedButton(
              onPressed: () async {
                Navigator.pop(context); // close dialog
                await ref
                    .read(formFillProvider(assignmentId).notifier)
                    .saveDraft();
                if (context.mounted) context.go('/forms');
              },
              child: const Text('Save Draft'),
            ),
          ],
        ),
      );
    } else {
      context.go('/forms');
    }
  }

  void _confirmSubmit(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Submit form?'),
        content: const Text(
            'Once submitted, you will not be able to edit this form.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () async {
              Navigator.pop(context); // close dialog
              final notifier =
                  ref.read(formFillProvider(assignmentId).notifier);
              final ok = await notifier.submit();
              if (context.mounted && ok) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Form submitted successfully'),
                    backgroundColor: SproutColors.green,
                  ),
                );
                context.go('/forms');
              }
            },
            child: const Text('Submit'),
          ),
        ],
      ),
    );
  }

  bool _allRequiredFilled(
      List<FormFieldDef> fields, Map<String, dynamic> values) {
    for (final f in fields) {
      if (!f.required) continue;
      // Skip hidden fields (conditional logic not met).
      if (f.conditionalLogic != null && !f.conditionalLogic!.evaluate(values)) {
        continue;
      }
      final v = values[f.id];
      if (v == null) return false;
      if (v is String && v.isEmpty) return false;
      if (v is List && v.isEmpty) return false;
    }
    return true;
  }

  int _filledCount(List<FormFieldDef> fields, Map<String, dynamic> values) {
    int count = 0;
    for (final f in fields) {
      final v = values[f.id];
      if (v == null) continue;
      if (v is String && v.isEmpty) continue;
      if (v is List && v.isEmpty) continue;
      if (v is bool && !v) continue;
      count++;
    }
    return count;
  }
}

// ── Progress bar ──────────────────────────────────────────────────────────────

class _ProgressBar extends StatelessWidget {
  final int filled;
  final int total;
  const _ProgressBar({required this.filled, required this.total});

  @override
  Widget build(BuildContext context) {
    final pct = total > 0 ? filled / total : 0.0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      color: SproutColors.cardBg,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('$filled of $total fields completed',
                  style: Theme.of(context).textTheme.bodySmall),
              Text('${(pct * 100).round()}%',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: pct,
              backgroundColor: SproutColors.border,
              valueColor:
                  const AlwaysStoppedAnimation<Color>(SproutColors.green),
              minHeight: 6,
            ),
          ),
        ],
      ),
    );
  }
}

// ── Bottom action bar ─────────────────────────────────────────────────────────

class _BottomBar extends StatelessWidget {
  final bool isSaving;
  final bool isSubmitting;
  final bool canSubmit;
  final VoidCallback onSaveDraft;
  final VoidCallback onSubmit;

  const _BottomBar({
    required this.isSaving,
    required this.isSubmitting,
    required this.canSubmit,
    required this.onSaveDraft,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 12,
        bottom: MediaQuery.of(context).padding.bottom + 12,
      ),
      decoration: const BoxDecoration(
        color: SproutColors.cardBg,
        border: Border(top: BorderSide(color: SproutColors.border)),
      ),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              onPressed: isSaving || isSubmitting ? null : onSaveDraft,
              icon: isSaving
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.save_outlined, size: 18),
              label: Text(isSaving ? 'Saving...' : 'Save Draft'),
              style: OutlinedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 14),
                side: const BorderSide(color: SproutColors.border),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: ElevatedButton.icon(
              onPressed:
                  canSubmit && !isSaving && !isSubmitting ? onSubmit : null,
              icon: isSubmitting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.send, size: 18),
              label: Text(isSubmitting ? 'Submitting...' : 'Submit'),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Error body ────────────────────────────────────────────────────────────────

class _ErrorBody extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _ErrorBody({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline,
                size: 48, color: SproutColors.bodyText),
            const SizedBox(height: 16),
            Text('Could not load form',
                style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text(message,
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
                maxLines: 3,
                overflow: TextOverflow.ellipsis),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}
