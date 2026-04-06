import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/auth/providers/auth_provider.dart';

/// The current user's role from Supabase JWT app_metadata.
/// Re-evaluates whenever the auth session changes (login/logout).
/// Returns 'staff' by default if no role is set.
final userRoleProvider = Provider<String>((ref) {
  final session = ref.watch(authSessionProvider).valueOrNull;
  if (session == null) return 'staff';
  final appMeta = session.user.appMetadata;
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
