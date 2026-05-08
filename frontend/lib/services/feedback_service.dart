import 'api_client.dart';

enum PlaceRating { like, dislike }

extension PlaceRatingApi on PlaceRating {
  String get apiValue {
    switch (this) {
      case PlaceRating.like:
        return 'LIKE';
      case PlaceRating.dislike:
        return 'DISLIKE';
    }
  }
}

class FeedbackService {
  /// LIKE/DISLIKE 등록 또는 갱신.
  /// 같은 place_id 에 다른 rating 으로 호출하면 백엔드에서 upsert 됨.
  static Future<void> rate({
    required int placeId,
    required PlaceRating rating,
  }) async {
    await ApiClient.post(
      '/api/feedback',
      body: {'place_id': placeId, 'rating': rating.apiValue},
      withAuth: true,
    );
  }

  /// 등록한 피드백 취소 (토글 해제).
  static Future<void> clear({required int placeId}) async {
    await ApiClient.delete('/api/feedback/$placeId', withAuth: true);
  }
}
