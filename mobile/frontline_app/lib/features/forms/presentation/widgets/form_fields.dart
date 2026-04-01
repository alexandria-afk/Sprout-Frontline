import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/forms/data/models/form_template.dart';

/// Renders the correct widget for a [FormFieldDef] based on its type.
class FormFieldWidget extends StatelessWidget {
  final FormFieldDef fieldDef;
  final dynamic value;
  final ValueChanged<dynamic> onChanged;

  const FormFieldWidget({
    super.key,
    required this.fieldDef,
    required this.value,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _FieldLabel(label: fieldDef.label, required: fieldDef.required),
          const SizedBox(height: 6),
          _buildInput(context),
        ],
      ),
    );
  }

  Widget _buildInput(BuildContext context) {
    switch (fieldDef.type) {
      case 'text':
        return _TextFieldInput(
          value: value as String? ?? '',
          placeholder: fieldDef.placeholder,
          onChanged: onChanged,
        );
      case 'number':
        return _NumberFieldInput(
          value: value,
          placeholder: fieldDef.placeholder,
          onChanged: onChanged,
        );
      case 'checkbox':
        return _CheckboxFieldInput(
          value: value as bool? ?? false,
          onChanged: onChanged,
        );
      case 'dropdown':
        return _DropdownFieldInput(
          value: value as String?,
          options: fieldDef.options,
          placeholder: fieldDef.placeholder,
          onChanged: onChanged,
        );
      case 'multi_select':
        return _MultiSelectFieldInput(
          value: (value as List?)?.cast<String>() ?? [],
          options: fieldDef.options,
          onChanged: onChanged,
        );
      case 'photo':
        return _PhotoFieldInput(
          value: (value as List?)?.cast<String>() ?? [],
          onChanged: onChanged,
        );
      case 'signature':
        return _SignatureFieldInput(
          hasSignature: value != null && value != '',
          onChanged: onChanged,
        );
      case 'datetime':
        return _DateTimeFieldInput(
          value: value as String?,
          onChanged: onChanged,
        );
      default:
        return _TextFieldInput(
          value: value as String? ?? '',
          placeholder: fieldDef.placeholder,
          onChanged: onChanged,
        );
    }
  }
}

// ── Label ─────────────────────────────────────────────────────────────────────

class _FieldLabel extends StatelessWidget {
  final String label;
  final bool required;
  const _FieldLabel({required this.label, required this.required});

  @override
  Widget build(BuildContext context) {
    return RichText(
      text: TextSpan(
        text: label,
        style: Theme.of(context)
            .textTheme
            .titleSmall
            ?.copyWith(fontWeight: FontWeight.w500),
        children: required
            ? [
                const TextSpan(
                  text: ' *',
                  style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold),
                ),
              ]
            : null,
      ),
    );
  }
}

// ── Text ──────────────────────────────────────────────────────────────────────

class _TextFieldInput extends StatefulWidget {
  final String value;
  final String? placeholder;
  final ValueChanged<dynamic> onChanged;
  const _TextFieldInput({
    required this.value,
    this.placeholder,
    required this.onChanged,
  });

  @override
  State<_TextFieldInput> createState() => _TextFieldInputState();
}

class _TextFieldInputState extends State<_TextFieldInput> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.value);
  }

  @override
  void didUpdateWidget(_TextFieldInput old) {
    super.didUpdateWidget(old);
    if (old.value != widget.value && widget.value != _controller.text) {
      _controller.text = widget.value;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      decoration: InputDecoration(hintText: widget.placeholder ?? 'Enter text'),
      onChanged: widget.onChanged,
      textInputAction: TextInputAction.next,
    );
  }
}

// ── Number ────────────────────────────────────────────────────────────────────

class _NumberFieldInput extends StatefulWidget {
  final dynamic value;
  final String? placeholder;
  final ValueChanged<dynamic> onChanged;
  const _NumberFieldInput({
    required this.value,
    this.placeholder,
    required this.onChanged,
  });

  @override
  State<_NumberFieldInput> createState() => _NumberFieldInputState();
}

class _NumberFieldInputState extends State<_NumberFieldInput> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(
      text: widget.value?.toString() ?? '',
    );
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: _controller,
      decoration:
          InputDecoration(hintText: widget.placeholder ?? 'Enter number'),
      keyboardType: const TextInputType.numberWithOptions(decimal: true),
      onChanged: (v) {
        final n = num.tryParse(v);
        widget.onChanged(n ?? v);
      },
      textInputAction: TextInputAction.next,
    );
  }
}

// ── Checkbox ──────────────────────────────────────────────────────────────────

class _CheckboxFieldInput extends StatelessWidget {
  final bool value;
  final ValueChanged<dynamic> onChanged;
  const _CheckboxFieldInput({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return SwitchListTile.adaptive(
      value: value,
      onChanged: (v) => onChanged(v),
      contentPadding: EdgeInsets.zero,
      activeTrackColor: SproutColors.green,
      title: Text(value ? 'Yes' : 'No',
          style: Theme.of(context).textTheme.bodyMedium),
    );
  }
}

// ── Dropdown ──────────────────────────────────────────────────────────────────

class _DropdownFieldInput extends StatelessWidget {
  final String? value;
  final List<String> options;
  final String? placeholder;
  final ValueChanged<dynamic> onChanged;
  const _DropdownFieldInput({
    required this.value,
    required this.options,
    this.placeholder,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      initialValue: options.contains(value) ? value : null,
      decoration: InputDecoration(hintText: placeholder ?? 'Select an option'),
      items: options
          .map((o) => DropdownMenuItem(value: o, child: Text(o)))
          .toList(),
      onChanged: (v) => onChanged(v),
    );
  }
}

// ── Multi-select ──────────────────────────────────────────────────────────────

class _MultiSelectFieldInput extends StatelessWidget {
  final List<String> value;
  final List<String> options;
  final ValueChanged<dynamic> onChanged;
  const _MultiSelectFieldInput({
    required this.value,
    required this.options,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      children: options.map((option) {
        final selected = value.contains(option);
        return FilterChip(
          label: Text(option),
          selected: selected,
          selectedColor: SproutColors.green.withValues(alpha: 0.2),
          checkmarkColor: SproutColors.green,
          onSelected: (isSelected) {
            final updated = List<String>.from(value);
            if (isSelected) {
              updated.add(option);
            } else {
              updated.remove(option);
            }
            onChanged(updated);
          },
        );
      }).toList(),
    );
  }
}

// ── Photo ─────────────────────────────────────────────────────────────────────

class _PhotoFieldInput extends StatelessWidget {
  final List<String> value; // list of file paths
  final ValueChanged<dynamic> onChanged;
  const _PhotoFieldInput({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            ...value.map((path) => _PhotoThumbnail(
                  path: path,
                  onRemove: () {
                    final updated = List<String>.from(value)..remove(path);
                    onChanged(updated);
                  },
                )),
            _AddPhotoButton(onPick: (path) {
              final updated = List<String>.from(value)..add(path);
              onChanged(updated);
            }),
          ],
        ),
      ],
    );
  }
}

class _PhotoThumbnail extends StatelessWidget {
  final String path;
  final VoidCallback onRemove;
  const _PhotoThumbnail({required this.path, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(
          width: 80,
          height: 80,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: SproutColors.border),
            color: SproutColors.pageBg,
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: Image.file(
              File(path),
              fit: BoxFit.cover,
              errorBuilder: (_, e, st) =>
                  const Icon(Icons.image, color: SproutColors.bodyText),
            ),
          ),
        ),
        Positioned(
          top: -4,
          right: -4,
          child: GestureDetector(
            onTap: onRemove,
            child: Container(
              padding: const EdgeInsets.all(2),
              decoration: const BoxDecoration(
                color: Colors.red,
                shape: BoxShape.circle,
              ),
              child:
                  const Icon(Icons.close, size: 14, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}

class _AddPhotoButton extends StatelessWidget {
  final ValueChanged<String> onPick;
  const _AddPhotoButton({required this.onPick});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => _showPicker(context),
      child: Container(
        width: 80,
        height: 80,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: SproutColors.border, width: 1.5),
          color: SproutColors.pageBg,
        ),
        child: const Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.add_a_photo_outlined,
                size: 24, color: SproutColors.bodyText),
            SizedBox(height: 4),
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
        child: Wrap(
          children: [
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
          ],
        ),
      ),
    );
  }

  Future<void> _pick(ImageSource source) async {
    final picker = ImagePicker();
    final image = await picker.pickImage(
      source: source,
      maxWidth: 1920,
      maxHeight: 1920,
      imageQuality: 80,
    );
    if (image != null) {
      onPick(image.path);
    }
  }
}

// ── Signature ─────────────────────────────────────────────────────────────────

class _SignatureFieldInput extends StatelessWidget {
  final bool hasSignature;
  final ValueChanged<dynamic> onChanged;
  const _SignatureFieldInput({
    required this.hasSignature,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        GestureDetector(
          onTap: () => _openSignaturePad(context),
          child: Container(
            height: 120,
            width: double.infinity,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(color: SproutColors.border),
              color: Colors.white,
            ),
            child: hasSignature
                ? const Center(
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.check_circle,
                            color: SproutColors.green, size: 20),
                        SizedBox(width: 8),
                        Text('Signature captured',
                            style: TextStyle(color: SproutColors.green)),
                      ],
                    ),
                  )
                : const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Icon(Icons.draw_outlined,
                            size: 32, color: SproutColors.bodyText),
                        SizedBox(height: 8),
                        Text('Tap to sign',
                            style: TextStyle(color: SproutColors.bodyText)),
                      ],
                    ),
                  ),
          ),
        ),
        if (hasSignature) ...[
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: () => onChanged(null),
              icon: const Icon(Icons.clear, size: 16),
              label: const Text('Clear'),
            ),
          ),
        ],
      ],
    );
  }

  void _openSignaturePad(BuildContext context) {
    Navigator.push(
      context,
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => _SignaturePadScreen(
          onSave: (data) => onChanged(data),
        ),
      ),
    );
  }
}

/// Full-screen signature capture using a simple CustomPainter.
class _SignaturePadScreen extends StatefulWidget {
  final ValueChanged<String> onSave;
  const _SignaturePadScreen({required this.onSave});

  @override
  State<_SignaturePadScreen> createState() => _SignaturePadScreenState();
}

class _SignaturePadScreenState extends State<_SignaturePadScreen> {
  final List<List<Offset>> _strokes = [];
  List<Offset> _currentStroke = [];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Sign Here'),
        actions: [
          TextButton(
            onPressed: _strokes.isEmpty ? null : _clear,
            child: const Text('Clear', style: TextStyle(color: Colors.white70)),
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
        onPanStart: (d) {
          setState(() {
            _currentStroke = [d.localPosition];
          });
        },
        onPanUpdate: (d) {
          setState(() {
            _currentStroke = [..._currentStroke, d.localPosition];
          });
        },
        onPanEnd: (_) {
          setState(() {
            _strokes.add(_currentStroke);
            _currentStroke = [];
          });
        },
        child: CustomPaint(
          painter: _SignaturePainter(
            strokes: _strokes,
            currentStroke: _currentStroke,
          ),
          size: Size.infinite,
        ),
      ),
    );
  }

  void _clear() {
    setState(() {
      _strokes.clear();
      _currentStroke = [];
    });
  }

  Future<void> _save() async {
    // Render signature to PNG bytes, encode as data URI.
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final painter = _SignaturePainter(
      strokes: _strokes,
      currentStroke: const [],
    );
    final size = Size(
      MediaQuery.of(context).size.width,
      MediaQuery.of(context).size.height - kToolbarHeight - 100,
    );
    painter.paint(canvas, size);
    final picture = recorder.endRecording();
    final img = await picture.toImage(size.width.toInt(), size.height.toInt());
    final byteData = await img.toByteData(format: ui.ImageByteFormat.png);
    if (byteData != null) {
      final bytes = byteData.buffer.asUint8List();
      // Store as base64 data URI for submission.
      final b64 = base64Encode(bytes);
      widget.onSave('data:image/png;base64,$b64');
    }
    if (mounted) Navigator.pop(context);
  }
}

class _SignaturePainter extends CustomPainter {
  final List<List<Offset>> strokes;
  final List<Offset> currentStroke;
  const _SignaturePainter({required this.strokes, required this.currentStroke});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = SproutColors.darkText
      ..strokeWidth = 2.5
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;

    for (final stroke in [...strokes, if (currentStroke.isNotEmpty) currentStroke]) {
      if (stroke.length < 2) continue;
      final path = Path()..moveTo(stroke.first.dx, stroke.first.dy);
      for (var i = 1; i < stroke.length; i++) {
        path.lineTo(stroke[i].dx, stroke[i].dy);
      }
      canvas.drawPath(path, paint);
    }
  }

  @override
  bool shouldRepaint(_SignaturePainter old) => true;
}

// ── DateTime ──────────────────────────────────────────────────────────────────

class _DateTimeFieldInput extends StatelessWidget {
  final String? value;
  final ValueChanged<dynamic> onChanged;
  const _DateTimeFieldInput({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    DateTime? parsed;
    if (value != null) {
      parsed = DateTime.tryParse(value!);
    }

    return GestureDetector(
      onTap: () => _pickDateTime(context, parsed),
      child: InputDecorator(
        decoration: const InputDecoration(
          suffixIcon: Icon(Icons.calendar_today, size: 20),
        ),
        child: Text(
          parsed != null
              ? '${parsed.year}-${_pad(parsed.month)}-${_pad(parsed.day)} '
                '${_pad(parsed.hour)}:${_pad(parsed.minute)}'
              : 'Select date & time',
          style: TextStyle(
            color: parsed != null
                ? SproutColors.darkText
                : SproutColors.bodyText.withValues(alpha: 0.6),
          ),
        ),
      ),
    );
  }

  String _pad(int n) => n.toString().padLeft(2, '0');

  Future<void> _pickDateTime(BuildContext context, DateTime? initial) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial ?? now,
      firstDate: DateTime(2020),
      lastDate: DateTime(2030),
    );
    if (date == null || !context.mounted) return;

    final time = await showTimePicker(
      context: context,
      initialTime: initial != null
          ? TimeOfDay.fromDateTime(initial)
          : TimeOfDay.now(),
    );
    if (time == null) return;

    final dt = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    onChanged(dt.toIso8601String());
  }
}
