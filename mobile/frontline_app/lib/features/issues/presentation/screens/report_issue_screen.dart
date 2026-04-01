import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/issues/data/models/issue_models.dart';
import 'package:frontline_app/features/issues/providers/issues_provider.dart';

class ReportIssueScreen extends ConsumerStatefulWidget {
  const ReportIssueScreen({super.key});

  @override
  ConsumerState<ReportIssueScreen> createState() => _ReportIssueScreenState();
}

class _ReportIssueScreenState extends ConsumerState<ReportIssueScreen> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  final _descFocus = FocusNode();

  final _locationCtrl = TextEditingController();
  final _equipmentCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
  }

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    _descFocus.dispose();
    _locationCtrl.dispose();
    _equipmentCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final formState = ref.watch(reportIssueProvider);
    final asyncCategories = ref.watch(issueCategoriesProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Report Issue'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/dashboard'),
        ),
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Title
                _label(context, 'Title', true),
                const SizedBox(height: 6),
                TextField(
                  controller: _titleCtrl,
                  decoration:
                      const InputDecoration(hintText: 'Brief summary'),
                  onChanged: ref.read(reportIssueProvider.notifier).setTitle,
                  textInputAction: TextInputAction.next,
                ),

                const SizedBox(height: 20),

                // Description
                _label(context, 'Description', true),
                const SizedBox(height: 6),
                TextField(
                  controller: _descCtrl,
                  focusNode: _descFocus,
                  decoration: const InputDecoration(
                      hintText: 'Describe the problem in detail'),
                  maxLines: 4,
                  onChanged:
                      ref.read(reportIssueProvider.notifier).setDescription,
                ),

                // Analyze with AI button
                if (formState.description.trim().length >= 10 &&
                    formState.aiSuggestion == null &&
                    !formState.isClassifying &&
                    !formState.aiAccepted) ...[
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: () =>
                          ref.read(reportIssueProvider.notifier).classify(),
                      icon: const Icon(Icons.auto_awesome, size: 16),
                      label: const Text('Analyze with AI'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: SproutColors.purple,
                        side: BorderSide(
                            color: SproutColors.purple.withValues(alpha: 0.4)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                    ),
                  ),
                ],

                // AI loading
                if (formState.isClassifying) ...[
                  const SizedBox(height: 12),
                  const _AiLoadingChip(),
                ],

                // AI suggestion card
                if (formState.aiSuggestion != null &&
                    !formState.isClassifying &&
                    !formState.aiAccepted) ...[
                  const SizedBox(height: 12),
                  _AiSuggestionCard(
                    suggestion: formState.aiSuggestion!,
                    onAccept: () {
                      final s = formState.aiSuggestion;
                      ref.read(reportIssueProvider.notifier).acceptSuggestion();
                      if (s != null && s.suggestedTitle.isNotEmpty) {
                        _titleCtrl.text = s.suggestedTitle;
                      }
                    },
                  ),
                ],

                // AI accepted confirmation
                if (formState.aiAccepted) ...[
                  const SizedBox(height: 10),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 12, vertical: 8),
                    decoration: BoxDecoration(
                      color: SproutColors.green.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: const Row(
                      children: [
                        Icon(Icons.check_circle,
                            size: 16, color: SproutColors.green),
                        SizedBox(width: 6),
                        Text('AI suggestion applied',
                            style: TextStyle(
                                color: SproutColors.green,
                                fontSize: 13,
                                fontWeight: FontWeight.w500)),
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: 20),

                // Category dropdown
                _label(context, 'Category', true),
                const SizedBox(height: 6),
                asyncCategories.when(
                  loading: () => const LinearProgressIndicator(),
                  error: (e, _) => Text('Could not load categories',
                      style: TextStyle(color: Colors.red.shade600)),
                  data: (cats) => DropdownButtonFormField<String>(
                    initialValue: cats.any((c) => c.id == formState.categoryId)
                        ? formState.categoryId
                        : null,
                    decoration: const InputDecoration(
                        hintText: 'Select category'),
                    items: cats
                        .map((c) => DropdownMenuItem(
                            value: c.id, child: Text(c.name)))
                        .toList(),
                    onChanged: (v) {
                      if (v != null) {
                        ref
                            .read(reportIssueProvider.notifier)
                            .setCategory(v);
                      }
                    },
                  ),
                ),

                const SizedBox(height: 20),

                // Where exactly
                _label(context, 'Where exactly?', false),
                const SizedBox(height: 6),
                TextField(
                  controller: _locationCtrl,
                  decoration: const InputDecoration(
                      hintText: 'e.g. Kitchen, left stove area'),
                  onChanged: ref
                      .read(reportIssueProvider.notifier)
                      .setLocationDescription,
                  textInputAction: TextInputAction.next,
                ),

                const SizedBox(height: 20),

                // Which equipment
                _label(context, 'Which equipment?', false),
                const SizedBox(height: 6),
                TextField(
                  controller: _equipmentCtrl,
                  decoration: const InputDecoration(
                      hintText: 'e.g. Fryer #2, Walk-in cooler'),
                  onChanged: (v) =>
                      ref.read(reportIssueProvider.notifier).setAssetId(v),
                  textInputAction: TextInputAction.next,
                ),

                const SizedBox(height: 20),

                // Priority
                _label(context, 'Priority', false),
                const SizedBox(height: 6),
                _PriorityPicker(
                  selected: formState.priority,
                  onChanged:
                      ref.read(reportIssueProvider.notifier).setPriority,
                ),

                const SizedBox(height: 20),

                // Safety risk toggle
                SwitchListTile.adaptive(
                  value: formState.isSafetyRisk,
                  onChanged:
                      ref.read(reportIssueProvider.notifier).setSafetyRisk,
                  title: const Text('Safety risk'),
                  subtitle: const Text('Mark if this poses a safety hazard'),
                  contentPadding: EdgeInsets.zero,
                  activeTrackColor: Colors.red,
                ),

                const SizedBox(height: 20),

                // Photos
                _label(context, 'Photos', false),
                const SizedBox(height: 6),
                _PhotoRow(
                  paths: formState.photoPaths,
                  onAdd: (path) =>
                      ref.read(reportIssueProvider.notifier).addPhoto(path),
                  onRemove: (path) =>
                      ref.read(reportIssueProvider.notifier).removePhoto(path),
                ),

                if (formState.error != null) ...[
                  const SizedBox(height: 16),
                  Text(formState.error!,
                      style: TextStyle(color: Colors.red.shade600)),
                ],
              ],
            ),
          ),

          // Submit bar
          _SubmitBar(
            canSubmit: formState.title.trim().isNotEmpty &&
                formState.description.trim().isNotEmpty &&
                formState.categoryId != null &&
                !formState.isSubmitting,
            isSubmitting: formState.isSubmitting,
            onSubmit: () async {
              final ok =
                  await ref.read(reportIssueProvider.notifier).submit();
              if (ok && context.mounted) {
                ref.read(reportIssueProvider.notifier).reset();
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Issue reported'),
                    backgroundColor: SproutColors.green,
                  ),
                );
                context.go('/dashboard');
              }
            },
          ),
        ],
      ),
    );
  }

  Widget _label(BuildContext context, String text, bool required) {
    return RichText(
      text: TextSpan(
        text: text,
        style: Theme.of(context)
            .textTheme
            .titleSmall
            ?.copyWith(fontWeight: FontWeight.w500),
        children: required
            ? const [
                TextSpan(
                    text: ' *',
                    style: TextStyle(
                        color: Colors.red, fontWeight: FontWeight.bold))
              ]
            : null,
      ),
    );
  }
}

// ── AI chips ──────────────────────────────────────────────────────────────────

class _AiLoadingChip extends StatelessWidget {
  const _AiLoadingChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: SproutColors.purple.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
      ),
      child: const Row(
        children: [
          SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: SproutColors.purple)),
          SizedBox(width: 8),
          Text('AI is classifying...',
              style: TextStyle(color: SproutColors.purple, fontSize: 13)),
        ],
      ),
    );
  }
}

class _AiSuggestionCard extends StatelessWidget {
  final IssueClassification suggestion;
  final VoidCallback onAccept;
  const _AiSuggestionCard(
      {required this.suggestion, required this.onAccept});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: SproutColors.purple.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
            color: SproutColors.purple.withValues(alpha: 0.2)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.auto_awesome,
                  size: 16, color: SproutColors.purple),
              const SizedBox(width: 6),
              Text('AI Suggestion',
                  style: TextStyle(
                      color: SproutColors.purple,
                      fontWeight: FontWeight.w600,
                      fontSize: 13)),
            ],
          ),
          const SizedBox(height: 8),
          Text(suggestion.reasoning,
              style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            children: [
              _chip('Priority: ${suggestion.priority}'),
              _chip('Type: ${suggestion.type}'),
              if (suggestion.isSafetyRisk) _chip('Safety risk', isRed: true),
            ],
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: onAccept,
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: SproutColors.purple),
                foregroundColor: SproutColors.purple,
                padding: const EdgeInsets.symmetric(vertical: 8),
              ),
              child: const Text('Accept suggestion'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _chip(String label, {bool isRed = false}) {
    final color = isRed ? Colors.red : SproutColors.purple;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Text(label,
          style:
              TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w500)),
    );
  }
}

// ── Priority picker ───────────────────────────────────────────────────────────

class _PriorityPicker extends StatelessWidget {
  final String selected;
  final ValueChanged<String> onChanged;
  const _PriorityPicker({required this.selected, required this.onChanged});

  static const _levels = [
    ('low', 'Low', Colors.green),
    ('medium', 'Medium', Colors.orange),
    ('high', 'High', Colors.deepOrange),
    ('critical', 'Critical', Colors.red),
  ];

  @override
  Widget build(BuildContext context) {
    return SegmentedButton<String>(
      segments: _levels
          .map((l) => ButtonSegment(value: l.$1, label: Text(l.$2)))
          .toList(),
      selected: {selected},
      onSelectionChanged: (s) => onChanged(s.first),
      style: ButtonStyle(
        visualDensity: VisualDensity.compact,
        textStyle: WidgetStatePropertyAll(
            Theme.of(context).textTheme.bodySmall),
      ),
    );
  }
}

// ── Photo row ─────────────────────────────────────────────────────────────────

class _PhotoRow extends StatelessWidget {
  final List<String> paths;
  final ValueChanged<String> onAdd;
  final ValueChanged<String> onRemove;
  const _PhotoRow(
      {required this.paths, required this.onAdd, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        ...paths.map((p) => _Thumb(path: p, onRemove: () => onRemove(p))),
        _AddButton(onPick: onAdd),
      ],
    );
  }
}

class _Thumb extends StatelessWidget {
  final String path;
  final VoidCallback onRemove;
  const _Thumb({required this.path, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: Image.file(File(path),
              width: 72, height: 72, fit: BoxFit.cover,
              errorBuilder: (_, e, st) => Container(
                width: 72, height: 72,
                color: SproutColors.border,
                child: const Icon(Icons.broken_image,
                    color: SproutColors.bodyText, size: 24),
              )),
        ),
        Positioned(
          top: -6,
          right: -6,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: const BoxDecoration(
                  color: Colors.red, shape: BoxShape.circle),
              child: const Icon(Icons.close, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

class _AddButton extends StatelessWidget {
  final ValueChanged<String> onPick;
  const _AddButton({required this.onPick});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _showPicker(context),
      child: Container(
        width: 72,
        height: 72,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: SproutColors.border, width: 1.5),
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_a_photo_outlined,
                size: 22, color: SproutColors.bodyText),
            SizedBox(height: 2),
            Text('Add',
                style: TextStyle(fontSize: 11, color: SproutColors.bodyText)),
          ],
        ),
      ),
    );
  }

  void _showPicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (_) => SafeArea(
        child: Wrap(children: [
          ListTile(
            leading: const Icon(Icons.camera_alt),
            title: const Text('Camera'),
            onTap: () {
              Navigator.pop(context);
              _pick(ImageSource.camera);
            },
          ),
          ListTile(
            leading: const Icon(Icons.photo_library),
            title: const Text('Gallery'),
            onTap: () {
              Navigator.pop(context);
              _pick(ImageSource.gallery);
            },
          ),
        ]),
      ),
    );
  }

  Future<void> _pick(ImageSource source) async {
    final img = await ImagePicker().pickImage(
        source: source, maxWidth: 1920, maxHeight: 1920, imageQuality: 80);
    if (img != null) onPick(img.path);
  }
}

// ── Submit bar ────────────────────────────────────────────────────────────────

class _SubmitBar extends StatelessWidget {
  final bool canSubmit;
  final bool isSubmitting;
  final VoidCallback onSubmit;
  const _SubmitBar(
      {required this.canSubmit,
      required this.isSubmitting,
      required this.onSubmit});

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
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: canSubmit && !isSubmitting ? onSubmit : null,
          icon: isSubmitting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.send, size: 18),
          label: Text(isSubmitting ? 'Submitting...' : 'Submit Issue'),
        ),
      ),
    );
  }
}
