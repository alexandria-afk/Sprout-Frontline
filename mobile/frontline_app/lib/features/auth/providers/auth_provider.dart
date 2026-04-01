import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:frontline_app/core/auth/auth_repository.dart';

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository();
});

/// Tracks the current Supabase session.
final authSessionProvider = StateNotifierProvider<AuthNotifier, AsyncValue<Session?>>(
  (ref) => AuthNotifier(ref.read(authRepositoryProvider)),
);

class AuthNotifier extends StateNotifier<AsyncValue<Session?>> {
  final AuthRepository _repo;
  late final StreamSubscription<AuthState> _authSub;

  AuthNotifier(this._repo) : super(const AsyncLoading()) {
    // Hydrate from current session immediately
    state = AsyncData(_repo.currentSession);
    // Listen to auth state changes (sign in / sign out / token refresh)
    _authSub = _repo.authStateChanges.listen((event) {
      state = AsyncData(event.session);
    });
  }

  @override
  void dispose() {
    _authSub.cancel();
    super.dispose();
  }

  Future<void> signIn(String email, String password) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final res = await _repo.signIn(email, password);
      return res.session;
    });
  }

  Future<void> signOut() async {
    await _repo.signOut();
    state = const AsyncData(null);
  }
}
