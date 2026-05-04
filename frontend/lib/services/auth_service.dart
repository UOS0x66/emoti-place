import 'api_client.dart';
import 'auth_storage.dart';

class AuthService {
  static Future<void> signup({
    required String email,
    required String nickname,
    required String password,
    String? mbti,
  }) async {
    final body = <String, dynamic>{
      'email': email,
      'nickname': nickname,
      'password': password,
    };
    if (mbti != null && mbti.isNotEmpty) body['mbti'] = mbti;

    final result = await ApiClient.post('/api/auth/signup', body: body);
    await AuthStorage.save(
      token: result['token'] as String,
      userId: result['user_id'].toString(),
      nickname: result['nickname'] as String,
    );
  }

  static Future<void> login({
    required String email,
    required String password,
  }) async {
    final result = await ApiClient.post(
      '/api/auth/login',
      body: {'email': email, 'password': password},
    );
    await AuthStorage.save(
      token: result['token'] as String,
      userId: result['user_id'].toString(),
      nickname: result['nickname'] as String,
    );
  }

  static Future<void> logout() async {
    await AuthStorage.clear();
  }
}
