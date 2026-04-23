import 'dart:convert';
import 'dart:developer' as developer;
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'auth_storage.dart';

class ApiException implements Exception {
  final int statusCode;
  final String message;
  ApiException(this.statusCode, this.message);

  @override
  String toString() => message;
}

class ApiClient {
  static String get _baseUrl => dotenv.env['API_BASE_URL'] ?? 'http://10.0.2.2:3000';

  static Future<Map<String, String>> _headers({bool withAuth = false}) async {
    final headers = {'Content-Type': 'application/json'};
    if (withAuth) {
      final token = await AuthStorage.getToken();
      if (token != null) headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  static Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = false,
  }) async {
    final url = '$_baseUrl$path';
    developer.log('POST $url body=$body', name: 'ApiClient');
    try {
      final response = await http.post(
        Uri.parse(url),
        headers: await _headers(withAuth: withAuth),
        body: body != null ? jsonEncode(body) : null,
      );
      developer.log('POST $url -> ${response.statusCode}', name: 'ApiClient');
      return _handleResponse(response);
    } catch (e, st) {
      developer.log('POST $url FAILED: $e', name: 'ApiClient', error: e, stackTrace: st);
      rethrow;
    }
  }

  static Future<dynamic> get(String path, {bool withAuth = false}) async {
    final url = '$_baseUrl$path';
    developer.log('GET $url', name: 'ApiClient');
    try {
      final response = await http.get(
        Uri.parse(url),
        headers: await _headers(withAuth: withAuth),
      );
      developer.log('GET $url -> ${response.statusCode}', name: 'ApiClient');
      return _handleResponse(response);
    } catch (e, st) {
      developer.log('GET $url FAILED: $e', name: 'ApiClient', error: e, stackTrace: st);
      rethrow;
    }
  }

  static dynamic _handleResponse(http.Response response) {
    final decoded = response.body.isNotEmpty ? jsonDecode(response.body) : null;
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return decoded;
    }
    // 인증 만료/실패 시 저장된 토큰을 정리한다.
    // 화면 전환은 호출 측에서 ApiException을 받고 처리하거나,
    // 앱 루트에서 전역 리스너로 감지한다.
    if (response.statusCode == 401) {
      AuthStorage.clear();
    }
    final errorMessage = decoded is Map && decoded['error'] != null
        ? decoded['error'] as String
        : '요청에 실패했습니다. (${response.statusCode})';
    throw ApiException(response.statusCode, errorMessage);
  }
}
