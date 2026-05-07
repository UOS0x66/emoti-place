import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';

class AuthStorage {
  static const _tokenKey = 'auth_token';
  static const _userIdKey = 'user_id';
  static const _nicknameKey = 'nickname';

  static Future<void> save({
    required String token,
    required String userId,
    required String nickname,
  }) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_tokenKey, token);
    await prefs.setString(_userIdKey, userId);
    await prefs.setString(_nicknameKey, nickname);
  }

  static Future<String?> getToken() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_tokenKey);
  }

  static Future<String?> getUserId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_userIdKey);
  }

  static Future<String?> getNickname() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_nicknameKey);
  }

  static Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_tokenKey);
    await prefs.remove(_userIdKey);
    await prefs.remove(_nicknameKey);
  }

  /// JWT의 exp(만료 시각) claim을 디코드해 만료 여부를 판단한다.
  /// 디코드 실패 / exp 누락 / 형식 깨짐 → 만료로 간주(보수적).
  /// 백엔드 추가 호출 없이 클라단에서만 검증한다.
  static bool isTokenExpired(String token) {
    try {
      final parts = token.split('.');
      if (parts.length != 3) return true;
      final payload = parts[1];
      // base64url → base64로 normalize + 패딩 보강
      final normalized = base64.normalize(payload);
      final decoded = utf8.decode(base64.decode(normalized));
      final claims = jsonDecode(decoded) as Map<String, dynamic>;
      final exp = claims['exp'];
      if (exp is! int) return true;
      final nowSec = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      return nowSec >= exp;
    } catch (_) {
      return true;
    }
  }

  /// 저장된 토큰이 유효(존재 + 미만료)할 때만 토큰 문자열을 반환.
  /// 만료된 토큰이면 자동으로 [clear]를 호출해 로컬 상태를 정리한다.
  static Future<String?> getValidToken() async {
    final token = await getToken();
    if (token == null || token.isEmpty) return null;
    if (isTokenExpired(token)) {
      await clear();
      return null;
    }
    return token;
  }
}
