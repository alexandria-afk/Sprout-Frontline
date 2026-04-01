import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/audits/data/models/audit_models.dart';
import 'package:frontline_app/features/audits/providers/audits_provider.dart';

class AuditFillScreen extends ConsumerWidget {
  final String templateId;
  const AuditFillScreen({super.key, required this.templateId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncState = ref.watch(auditFillProvider(templateId));

    return asyncState.when(
      loading: () => Scaffold(
        appBar: AppBar(
          title: const Text('Loading...'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/dashboard'),
          ),
        ),
        body: const Center(child: CircularProgressIndicator()),
      ),
      error: (err, _) => Scaffold(
        appBar: AppBar(
          title: const Text('Error'),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => context.go('/dashboard'),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('Could not load audit',
                  style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 16),
              ElevatedButton(
                onPressed: () =>
                    ref.invalidate(auditFillProvider(templateId)),
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      data: (auditState) {
        if (auditState.result != null) {
          return _ResultScreen(
            result: auditState.result!,
            templateId: templateId,
          );
        }
        return _FillBody(templateId: templateId, auditState: auditState);
      },
    );
  }
}

// ── Fill body ─────────────────────────────────────────────────────────────────

class _FillBody extends ConsumerWidget {
  final String templateId;
  final AuditFillState auditState;
  const _FillBody({required this.templateId, required this.auditState});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final template = auditState.template;
    final notifier = ref.read(auditFillProvider(templateId).notifier);

    return Scaffold(
      appBar: AppBar(
        title: Text(template.title),
        leading: IconButton(
          icon: const Icon(Icons.close),
          onPressed: () => context.go('/audits'),
        ),
      ),
      body: Column(
        children: [
          if (auditState.error != null)
            MaterialBanner(
              content: Text(auditState.error!),
              backgroundColor: Colors.red.shade50,
              leading: const Icon(Icons.error, color: Colors.red),
              actions: [
                TextButton(
                  onPressed: () {},
                  child: const Text('DISMISS'),
                ),
              ],
            ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                // Location ID input (simple text for now)
                Text('Location',
                    style: Theme.of(context)
                        .textTheme
                        .titleSmall
                        ?.copyWith(fontWeight: FontWeight.w500)),
                const SizedBox(height: 6),
                TextField(
                  decoration: const InputDecoration(
                      hintText: 'Enter location ID'),
                  onChanged: notifier.setLocationId,
                ),
                const SizedBox(height: 20),

                // Sections + fields
                ...template.sections.map((section) => _SectionWidget(
                      section: section,
                      fieldScores: template.fieldScores,
                      values: auditState.values,
                      onChanged: notifier.setFieldValue,
                      onComment: notifier.setFieldComment,
                    )),
              ],
            ),
          ),

          // Submit bar
          _SubmitBar(
            isSubmitting: auditState.isSubmitting,
            canSubmit: auditState.locationId != null &&
                auditState.locationId!.isNotEmpty &&
                !auditState.isSubmitting,
            onSubmit: () => _submit(context, ref),
          ),
        ],
      ),
    );
  }

  Future<void> _submit(BuildContext context, WidgetRef ref) async {
    // Open signature pad first.
    final signatureData = await Navigator.push<String>(
      context,
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => const _SignatureCaptureScreen(),
      ),
    );
    if (signatureData == null || !context.mounted) return;

    final notifier = ref.read(auditFillProvider(templateId).notifier);
    final result = await notifier.submit();
    if (result != null) {
      // Upload signature.
      try {
        await notifier.captureSignature(result.id, signatureData);
      } catch (_) {
        // Non-blocking — signature capture failure doesn't block result.
      }
    }
  }
}

// ── Section widget ────────────────────────────────────────────────────────────

class _SectionWidget extends StatelessWidget {
  final AuditSection section;
  final Map<String, double> fieldScores;
  final Map<String, dynamic> values;
  final void Function(String, dynamic) onChanged;
  final void Function(String, String?) onComment;

  const _SectionWidget({
    required this.section,
    required this.fieldScores,
    required this.values,
    required this.onChanged,
    required this.onComment,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
              horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: SproutColors.navy.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(section.title,
              style: Theme.of(context)
                  .textTheme
                  .titleSmall
                  ?.copyWith(fontWeight: FontWeight.w600)),
        ),
        const SizedBox(height: 12),
        ...section.fields.map((field) => _AuditFieldWidget(
              field: field,
              maxScore: fieldScores[field.id] ?? 1.0,
              value: values[field.id],
              onChanged: (v) => onChanged(field.id, v),
              onComment: (c) => onComment(field.id, c),
            )),
        const SizedBox(height: 8),
      ],
    );
  }
}

// ── Field widget ──────────────────────────────────────────────────────────────

class _AuditFieldWidget extends StatelessWidget {
  final AuditField field;
  final double maxScore;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;
  final ValueChanged<String?> onComment;

  const _AuditFieldWidget({
    required this.field,
    required this.maxScore,
    required this.value,
    required this.onChanged,
    required this.onComment,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Label + score badge
          Row(
            children: [
              Expanded(
                child: RichText(
                  text: TextSpan(
                    text: field.label,
                    style: Theme.of(context)
                        .textTheme
                        .bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w500),
                    children: [
                      if (field.isRequired)
                        const TextSpan(
                          text: ' *',
                          style: TextStyle(
                              color: Colors.red,
                              fontWeight: FontWeight.bold),
                        ),
                    ],
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: SproutColors.cyan.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text('${maxScore.toStringAsFixed(0)} pts',
                    style: const TextStyle(
                        color: SproutColors.cyan,
                        fontSize: 10,
                        fontWeight: FontWeight.w600)),
              ),
              if (field.isCritical) ...[
                const SizedBox(width: 4),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.red.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: const Text('Critical',
                      style: TextStyle(
                          color: Colors.red,
                          fontSize: 10,
                          fontWeight: FontWeight.w600)),
                ),
              ],
            ],
          ),
          const SizedBox(height: 6),

          // Input
          _buildInput(context),
        ],
      ),
    );
  }

  Widget _buildInput(BuildContext context) {
    switch (field.fieldType) {
      case 'checkbox':
        return Row(
          children: [
            ChoiceChip(
              label: const Text('Yes'),
              selected: value == 'yes',
              selectedColor: SproutColors.green.withValues(alpha: 0.2),
              onSelected: (_) => onChanged('yes'),
            ),
            const SizedBox(width: 8),
            ChoiceChip(
              label: const Text('No'),
              selected: value == 'no',
              selectedColor: Colors.red.withValues(alpha: 0.2),
              onSelected: (_) => onChanged('no'),
            ),
            const SizedBox(width: 8),
            ChoiceChip(
              label: const Text('N/A'),
              selected: value == 'na',
              onSelected: (_) => onChanged('na'),
            ),
          ],
        );
      case 'dropdown':
        return DropdownButtonFormField<String>(
          initialValue: field.options.contains(value) ? value as String : null,
          decoration:
              InputDecoration(hintText: field.placeholder ?? 'Select'),
          items: field.options
              .map((o) => DropdownMenuItem(value: o, child: Text(o)))
              .toList(),
          onChanged: (v) => onChanged(v),
        );
      case 'number':
        return TextField(
          decoration:
              InputDecoration(hintText: field.placeholder ?? 'Enter number'),
          keyboardType:
              const TextInputType.numberWithOptions(decimal: true),
          onChanged: onChanged,
        );
      default:
        return TextField(
          decoration:
              InputDecoration(hintText: field.placeholder ?? 'Enter text'),
          onChanged: onChanged,
          maxLines: field.fieldType == 'text' ? 2 : 1,
        );
    }
  }
}

// ── Submit bar ────────────────────────────────────────────────────────────────

class _SubmitBar extends StatelessWidget {
  final bool isSubmitting;
  final bool canSubmit;
  final VoidCallback onSubmit;
  const _SubmitBar({
    required this.isSubmitting,
    required this.canSubmit,
    required this.onSubmit,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.only(
        left: 16, right: 16, top: 12,
        bottom: MediaQuery.of(context).padding.bottom + 12,
      ),
      decoration: const BoxDecoration(
        color: SproutColors.cardBg,
        border: Border(top: BorderSide(color: SproutColors.border)),
      ),
      child: SizedBox(
        width: double.infinity,
        child: ElevatedButton.icon(
          onPressed: canSubmit ? onSubmit : null,
          icon: isSubmitting
              ? const SizedBox(
                  width: 16, height: 16,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: Colors.white))
              : const Icon(Icons.send, size: 18),
          label: Text(isSubmitting ? 'Submitting...' : 'Sign & Submit'),
        ),
      ),
    );
  }
}

// ── Result screen ─────────────────────────────────────────────────────────────

class _ResultScreen extends StatelessWidget {
  final AuditSubmissionResult result;
  final String templateId;
  const _ResultScreen({required this.result, required this.templateId});

  @override
  Widget build(BuildContext context) {
    final passed = result.passed;
    final color = passed ? SproutColors.green : Colors.red;

    return Scaffold(
      appBar: AppBar(title: const Text('Audit Result')),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircleAvatar(
                radius: 48,
                backgroundColor: color.withValues(alpha: 0.12),
                child: Text(
                  '${result.overallScore.round()}%',
                  style: TextStyle(
                      color: color,
                      fontSize: 28,
                      fontWeight: FontWeight.bold),
                ),
              ),
              const SizedBox(height: 20),
              Text(
                passed ? 'Passed' : 'Failed',
                style: TextStyle(
                    fontSize: 24, fontWeight: FontWeight.bold, color: color),
              ),
              const SizedBox(height: 4),
              Text(
                'Passing score: ${result.passingScore.round()}%',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              if (!passed && result.capId != null) ...[
                const SizedBox(height: 20),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.orange.shade50,
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(color: Colors.orange.shade200),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.assignment_late,
                          color: Colors.orange, size: 20),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'A Corrective Action Plan has been auto-generated '
                          'and assigned for follow-up.',
                          style: TextStyle(fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => context.go('/audits'),
                  child: const Text('Done'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ── Signature capture (reused pattern from form_fields.dart) ──────────────────

class _SignatureCaptureScreen extends StatefulWidget {
  const _SignatureCaptureScreen();

  @override
  State<_SignatureCaptureScreen> createState() =>
      _SignatureCaptureScreenState();
}

class _SignatureCaptureScreenState extends State<_SignatureCaptureScreen> {
  final List<List<Offset>> _strokes = [];
  List<Offset> _currentStroke = [];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Auditor Signature'),
        actions: [
          TextButton(
            onPressed: _strokes.isEmpty ? null : _clear,
            child: const Text('Clear',
                style: TextStyle(color: Colors.white70)),
          ),
          TextButton(
            onPressed: _strokes.isEmpty ? null : _save,
            child: const Text('Done',
                style: TextStyle(
                    color: Colors.white, fontWeight: FontWeight.bold)),
          ),
        ],
      ),
      body: GestureDetector(
        onPanStart: (d) =>
            setState(() => _currentStroke = [d.localPosition]),
        onPanUpdate: (d) => setState(
            () => _currentStroke = [..._currentStroke, d.localPosition]),
        onPanEnd: (_) => setState(() {
          _strokes.add(_currentStroke);
          _currentStroke = [];
        }),
        child: CustomPaint(
          painter: _SigPainter(_strokes, _currentStroke),
          size: Size.infinite,
        ),
      ),
    );
  }

  void _clear() => setState(() {
        _strokes.clear();
        _currentStroke = [];
      });

  Future<void> _save() async {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    _SigPainter(_strokes, const []).paint(
      canvas,
      Size(MediaQuery.of(context).size.width,
          MediaQuery.of(context).size.height - 150),
    );
    final picture = recorder.endRecording();
    final img = await picture.toImage(
      MediaQuery.of(context).size.width.toInt(),
      (MediaQuery.of(context).size.height - 150).toInt(),
    );
    final byteData =
        await img.toByteData(format: ui.ImageByteFormat.png);
    if (byteData != null && mounted) {
      final b64 = base64Encode(byteData.buffer.asUint8List());
      Navigator.pop(context, 'data:image/png;base64,$b64');
    }
  }
}

class _SigPainter extends CustomPainter {
  final List<List<Offset>> strokes;
  final List<Offset> current;
  const _SigPainter(this.strokes, this.current);

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = SproutColors.darkText
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    for (final stroke
        in [...strokes, if (current.isNotEmpty) current]) {
      if (stroke.length < 2) continue;
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (var i = 1; i < stroke.length; i++) {
        path.lineTo(stroke[i].dx, stroke[i].dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_SigPainter old) => true;
}
