import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/tasks/providers/tasks_provider.dart';

class CreateTaskScreen extends ConsumerStatefulWidget {
  const CreateTaskScreen({super.key});

  @override
  ConsumerState<CreateTaskScreen> createState() =>
      _CreateTaskScreenState();
}

class _CreateTaskScreenState extends ConsumerState<CreateTaskScreen> {
  final _titleCtrl = TextEditingController();
  final _descCtrl = TextEditingController();
  String _priority = 'medium';
  DateTime? _dueDate;
  bool _submitting = false;

  @override
  void dispose() {
    _titleCtrl.dispose();
    _descCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('New Task'),
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
                const Text('Title',
                    style: TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 14)),
                const SizedBox(height: 6),
                TextField(
                  controller: _titleCtrl,
                  decoration:
                      const InputDecoration(hintText: 'What needs to be done?'),
                  textInputAction: TextInputAction.next,
                ),

                const SizedBox(height: 20),

                // Description
                const Text('Description',
                    style: TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 14)),
                const SizedBox(height: 6),
                TextField(
                  controller: _descCtrl,
                  decoration:
                      const InputDecoration(hintText: 'Add details (optional)'),
                  maxLines: 4,
                ),

                const SizedBox(height: 20),

                // Priority
                const Text('Priority',
                    style: TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 14)),
                const SizedBox(height: 6),
                SegmentedButton<String>(
                  segments: const [
                    ButtonSegment(value: 'low', label: Text('Low')),
                    ButtonSegment(value: 'medium', label: Text('Medium')),
                    ButtonSegment(value: 'high', label: Text('High')),
                    ButtonSegment(
                        value: 'critical', label: Text('Critical')),
                  ],
                  selected: {_priority},
                  onSelectionChanged: (s) =>
                      setState(() => _priority = s.first),
                  style: ButtonStyle(
                    visualDensity: VisualDensity.compact,
                    textStyle: WidgetStatePropertyAll(
                        Theme.of(context).textTheme.bodySmall),
                  ),
                ),

                const SizedBox(height: 20),

                // Due date
                const Text('Due Date',
                    style: TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 14)),
                const SizedBox(height: 6),
                GestureDetector(
                  onTap: _pickDueDate,
                  child: InputDecorator(
                    decoration: const InputDecoration(
                      suffixIcon:
                          Icon(Icons.calendar_today, size: 20),
                    ),
                    child: Text(
                      _dueDate != null
                          ? '${_dueDate!.year}-${_pad(_dueDate!.month)}-${_pad(_dueDate!.day)}'
                          : 'Select due date (optional)',
                      style: TextStyle(
                        color: _dueDate != null
                            ? SproutColors.darkText
                            : SproutColors.bodyText.withValues(alpha: 0.6),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),

          // Submit
          Container(
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
                onPressed: _titleCtrl.text.trim().isNotEmpty &&
                        !_submitting
                    ? _submit
                    : null,
                icon: _submitting
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.add_task, size: 18),
                label:
                    Text(_submitting ? 'Creating...' : 'Create Task'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _pad(int n) => n.toString().padLeft(2, '0');

  Future<void> _pickDueDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 1)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365)),
    );
    if (date != null && mounted) {
      final time = await showTimePicker(
        context: context,
        initialTime: const TimeOfDay(hour: 17, minute: 0),
      );
      setState(() {
        _dueDate = time != null
            ? DateTime(date.year, date.month, date.day, time.hour, time.minute)
            : date;
      });
    }
  }

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await DioClient.instance.post(
        '/api/v1/tasks/',
        data: {
          'title': _titleCtrl.text.trim(),
          if (_descCtrl.text.trim().isNotEmpty)
            'description': _descCtrl.text.trim(),
          'priority': _priority,
          'source_type': 'manual',
          if (_dueDate != null) 'due_at': _dueDate!.toIso8601String(),
        },
      );
      if (mounted) {
        ref.read(myTasksProvider.notifier).refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Task created'),
            backgroundColor: SproutColors.green,
          ),
        );
        context.go('/tasks');
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }
}
