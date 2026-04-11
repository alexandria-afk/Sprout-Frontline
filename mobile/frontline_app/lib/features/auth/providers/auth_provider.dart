import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:frontline_app/core/auth/auth_repository.dart';
import 'package:frontline_app/core/offline/hive_service.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository());

/// True when a valid (or refreshable) token is in secure storage.
final authSessionProvider = StateNotifierProvider<AuthNotifier, AsyncValue<bool>>(
  (ref) => AuthNotifier(ref.read(authRepositoryProvider)),
);

class AuthNotifier extends StateNotifier<AsyncValue<bool>> {
  final AuthRepository _repo;

  AuthNotifier(this._repo) : super(const AsyncLoading()) {
    _init();
  }

  Future<void> _init() async {
    state = AsyncData(await _repo.isSignedIn());
  }

  /// Launches browser for Keycloak login (PKCE flow).
  Future<void> signIn() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await _repo.signIn();
      return true;
    });
  }

  Future<void> signOut() async {
    await HiveService.clearUserCaches();
    await _repo.signOut();
    state = const AsyncData(false);
  }
}

/// Provides the current user's ID (sub claim) from the JWT.
final currentUserIdProvider = FutureProvider<String?>((ref) async {
  final repo = ref.read(authRepositoryProvider);
  return repo.getCurrentUserId();
});
