import 'dart:async';
import 'dart:convert';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:http/http.dart' as http;
import 'auth_storage.dart';

class ChatService {
  static String get _baseUrl => dotenv.env['API_BASE_URL'] ?? 'http://10.0.2.2:3000';

  /// SSE 스트림으로 응답 토큰을 하나씩 yield한다.
  static Stream<String> streamMessage({
    required String sessionId,
    required String message,
  }) async* {
    final token = await AuthStorage.getToken();
    final uri = Uri.parse('$_baseUrl/api/chat/message');

    final request = http.Request('POST', uri);
    request.headers['Content-Type'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    request.body = jsonEncode({'session_id': sessionId, 'message': message});

    final client = http.Client();
    try {
      final response = await client.send(request);

      if (response.statusCode != 200) {
        final body = await response.stream.bytesToString();
        String errorMessage = '채팅 요청에 실패했습니다. (${response.statusCode})';
        try {
          final decoded = jsonDecode(body);
          if (decoded is Map && decoded['error'] != null) {
            errorMessage = decoded['error'] as String;
          }
        } catch (_) {}
        throw Exception(errorMessage);
      }

      String buffer = '';
      await for (final chunk in response.stream.transform(utf8.decoder)) {
        buffer += chunk;
        // SSE 이벤트 단위 파싱 (\n\n)
        while (true) {
          final idx = buffer.indexOf('\n\n');
          if (idx == -1) break;
          final event = buffer.substring(0, idx);
          buffer = buffer.substring(idx + 2);

          for (final line in event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            final jsonStr = line.substring(6);
            final data = jsonDecode(jsonStr);
            if (data is Map) {
              if (data['error'] != null) {
                throw Exception(data['error'] as String);
              }
              if (data['done'] == true) return;
              if (data['token'] != null) {
                yield data['token'] as String;
              }
            }
          }
        }
      }
    } finally {
      client.close();
    }
  }
}
