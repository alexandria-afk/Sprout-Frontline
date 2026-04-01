import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// The current user's role from Supabase JWT app_metadata.
/// Returns 'staff' by default if no role is set.
final userRoleProvider = Provider<String>((ref) {
  final session = Supabase.instance.client.auth.currentSession;
  if (session == null) return 'staff';
  final user = session.user;
  final appMeta = user.appMetadata;
  return (appMeta['role'] as String?) ?? 'staff';
});

/// Whether the current user is at least a manager (manager, admin, super_admin).
final isManagerOrAboveProvider = Provider<bool>((ref) {
  final role = ref.watch(userRoleProvider);
  return role == 'manager' || role == 'admin' || role == 'super_admin';
});

/// Whether the current user is at least an admin (admin, super_admin).
final isAdminProvider = Provider<bool>((ref) {
  final role = ref.watch(userRoleProvider);
  return role == 'admin' || role == 'super_admin';
});
