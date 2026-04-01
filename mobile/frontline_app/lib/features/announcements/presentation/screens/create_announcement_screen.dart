import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:frontline_app/core/api/dio_client.dart';
import 'package:frontline_app/core/theme/app_theme.dart';
import 'package:frontline_app/features/announcements/providers/announcements_provider.dart';

class CreateAnnouncementScreen extends ConsumerStatefulWidget {
  const CreateAnnouncementScreen({super.key});

  @override
  ConsumerState<CreateAnnouncementScreen> createState() =>
      _CreateAnnouncementScreenState();
}

class _CreateAnnouncementScreenState
    extends ConsumerState<CreateAnnouncementScreen> {
  final _titleCtrl = TextEditingController();
  final _bodyCtrl = TextEditingController();
  bool _requiresAck = false;
  bool _submitting = false;
  final Set<String> _targetRoles = {};

  static const _roles = ['staff', 'manager', 'admin'];

  @override
  void dispose() {
    _titleCtrl.dispose();
    _bodyCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('New Announcement'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/announcements'),
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
                  decoration: const InputDecoration(
                      hintText: 'Announcement title'),
                  textInputAction: TextInputAction.next,
                ),

                const SizedBox(height: 20),

                // Body
                const Text('Body',
                    style: TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 14)),
                const SizedBox(height: 6),
                TextField(
                  controller: _bodyCtrl,
                  decoration: const InputDecoration(
                      hintText: 'Write your announcement...'),
                  maxLines: 6,
                ),

                const SizedBox(height: 20),

                // Target roles
                const Text('Target Roles',
                    style: TextStyle(
                        fontWeight: FontWeight.w500, fontSize: 14)),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 8,
                  children: _roles.map((role) {
                    final selected = _targetRoles.contains(role);
                    return FilterChip(
                      label: Text(role[0].toUpperCase() +
                          role.substring(1)),
                      selected: selected,
                      selectedColor:
                          SproutColors.green.withValues(alpha: 0.2),
                      checkmarkColor: SproutColors.green,
                      onSelected: (v) => setState(() {
                        if (v) {
                          _targetRoles.add(role);
                        } else {
                          _targetRoles.remove(role);
                        }
                      }),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 4),
                Text('Leave empty to send to everyone',
                    style: Theme.of(context).textTheme.bodySmall),

                const SizedBox(height: 20),

                // Requires acknowledgement
                SwitchListTile.adaptive(
                  value: _requiresAck,
                  onChanged: (v) => setState(() => _requiresAck = v),
                  title: const Text('Requires acknowledgement'),
                  subtitle: const Text(
                      'Staff must acknowledge they have read this'),
                  contentPadding: EdgeInsets.zero,
                  activeTrackColor: SproutColors.green,
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
                onPressed: _canSubmit && !_submitting ? _submit : null,
                icon: _submitting
                    ? const SizedBox(
                        width: 16, height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.send, size: 18),
                label: Text(
                    _submitting ? 'Publishing...' : 'Publish'),
              ),
            ),
          ),
        ],
      ),
    );
  }

  bool get _canSubmit =>
      _titleCtrl.text.trim().isNotEmpty &&
      _bodyCtrl.text.trim().isNotEmpty;

  Future<void> _submit() async {
    setState(() => _submitting = true);
    try {
      await DioClient.instance.post(
        '/api/v1/announcements/',
        data: {
          'title': _titleCtrl.text.trim(),
          'body': _bodyCtrl.text.trim(),
          'requires_acknowledgement': _requiresAck,
          if (_targetRoles.isNotEmpty)
            'target_roles': _targetRoles.toList(),
        },
      );
      if (mounted) {
        ref.read(announcementsProvider.notifier).refresh();
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Announcement published'),
            backgroundColor: SproutColors.green,
          ),
        );
        context.go('/announcements');
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
