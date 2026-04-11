import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/features/auth/providers/auth_provider.dart';

/// The current user's role from the Keycloak JWT claims.
/// Checks `realm_access.roles` and falls back to a top-level `role` claim.
/// Returns 'staff' by default if no role is set or the user is not signed in.
final userRoleProvider = Provider<String>((ref) {
  final isSignedIn = ref.watch(authSessionProvider).valueOrNull ?? false;
  if (!isSignedIn) return 'staff';

  // Read the cached claims synchronously from the FutureProvider's cached value.
  final claimsAsync = ref.watch(currentUserClaimsProvider);
  final claims = claimsAsync.valueOrNull;
  if (claims == null) return 'staff';

  // Keycloak puts roles in realm_access.roles
  final realmAccess = claims['realm_access'] as Map<String, dynamic>?;
  final roles = (realmAccess?['roles'] as List?)?.cast<String>() ?? [];
  for (final r in ['super_admin', 'admin', 'manager']) {
    if (roles.contains(r)) return r;
  }

  // Fallback: top-level role claim (set via mapper in Keycloak)
  final topLevel = claims['role'] as String?;
  if (topLevel != null) return topLevel;

  return 'staff';
});

/// Provides the current user's JWT claims map (cached via FutureProvider).
final currentUserClaimsProvider = FutureProvider<Map<String, dynamic>?>((ref) async {
  final repo = ref.read(authRepositoryProvider);
  return repo.getCurrentUserClaims();
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
