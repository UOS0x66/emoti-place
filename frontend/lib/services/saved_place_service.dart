import 'api_client.dart';
import 'recommend_service.dart';

class SavedPlaceService {
  static Future<List<RecommendedPlace>> list() async {
    final result = await ApiClient.get('/api/saved-places', withAuth: true);
    final list = (result['places'] as List).cast<Map<String, dynamic>>();
    return list.map(RecommendedPlace.fromJson).toList();
  }

  static Future<void> save({
    required int placeId,
    String? personaReason,
  }) async {
    final body = <String, dynamic>{'place_id': placeId};
    if (personaReason != null) body['persona_reason'] = personaReason;
    await ApiClient.post('/api/saved-places', body: body, withAuth: true);
  }

  static Future<void> unsave({required int placeId}) async {
    await ApiClient.delete('/api/saved-places/$placeId', withAuth: true);
  }
}
