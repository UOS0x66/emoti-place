import 'api_client.dart';

class RecommendedPlace {
  final int placeId;
  final String name;
  final String category;
  final String address;
  final double lat;
  final double lng;
  final String? photo;
  final double distance;
  final String? atmosphereText;
  final String? summaryText;
  final dynamic operatingHours;
  final int? maxGroupSize;
  final bool isOutdoor;
  final String? reason;
  final String? psychRationale;
  final double similarity;

  const RecommendedPlace({
    required this.placeId,
    required this.name,
    required this.category,
    required this.address,
    required this.lat,
    required this.lng,
    this.photo,
    required this.distance,
    this.atmosphereText,
    this.summaryText,
    this.operatingHours,
    this.maxGroupSize,
    this.isOutdoor = false,
    this.reason,
    this.psychRationale,
    this.similarity = 0,
  });

  /// 카드에 표시할 요약 (백엔드 summary_text 우선, 없으면 atmosphereText fallback).
  String? get displayDescription => summaryText ?? atmosphereText;

  String? get operatingHoursText {
    if (operatingHours == null) return null;
    if (operatingHours is String) return operatingHours as String;
    if (operatingHours is Map) {
      final m = operatingHours as Map;
      if (m['open'] != null && m['close'] != null) {
        return '${m['open']} - ${m['close']}';
      }
    }
    return null;
  }

  factory RecommendedPlace.fromJson(Map<String, dynamic> json) {
    return RecommendedPlace(
      placeId: json['place_id'] as int,
      name: json['name'] as String,
      category: (json['category'] ?? '') as String,
      address: (json['address'] ?? '') as String,
      lat: (json['lat'] as num).toDouble(),
      lng: (json['lng'] as num).toDouble(),
      photo: json['photo'] as String?,
      distance: (json['distance'] as num?)?.toDouble()
          ?? (json['distance_km'] as num?)?.toDouble()
          ?? 0,
      atmosphereText: json['atmosphere_text'] as String?,
      summaryText: json['summary_text'] as String?,
      operatingHours: json['operating_hours'],
      maxGroupSize: json['max_group_size'] as int?,
      isOutdoor: (json['is_outdoor'] ?? false) as bool,
      reason: json['reason'] as String?,
      psychRationale: json['psych_rationale'] as String?,
      similarity: (json['similarity'] as num?)?.toDouble() ?? 0,
    );
  }
}

/// 이번 추천에 적용된 개인화 상태. 사용자가 LIKE 누적할수록 pref_alpha 가 0→0.5 로 상승.
class Personalization {
  final int nLikes;
  final double prefAlpha;
  final int excludedDislikes;

  const Personalization({
    required this.nLikes,
    required this.prefAlpha,
    required this.excludedDislikes,
  });

  static const empty = Personalization(nLikes: 0, prefAlpha: 0, excludedDislikes: 0);

  factory Personalization.fromJson(Map<String, dynamic> json) {
    return Personalization(
      nLikes: (json['n_likes'] as num?)?.toInt() ?? 0,
      prefAlpha: (json['pref_alpha'] as num?)?.toDouble() ?? 0,
      excludedDislikes: (json['excluded_dislikes'] as num?)?.toInt() ?? 0,
    );
  }
}

class RecommendResult {
  final List<RecommendedPlace> places;
  final Personalization personalization;

  const RecommendResult({required this.places, required this.personalization});
}

class RecommendService {
  static Future<RecommendResult> fetch({
    required String sessionId,
    required double lat,
    required double lng,
  }) async {
    final result = await ApiClient.post(
      '/api/recommend',
      body: {'session_id': sessionId, 'lat': lat, 'lng': lng},
      withAuth: true,
    );
    final list = (result['places'] as List).cast<Map<String, dynamic>>();
    final places = list.map(RecommendedPlace.fromJson).toList();
    final personalization = result['personalization'] is Map
        ? Personalization.fromJson(
            (result['personalization'] as Map).cast<String, dynamic>())
        : Personalization.empty;
    return RecommendResult(places: places, personalization: personalization);
  }

  /// 같은 세션에 대해 다음 배치의 추천 장소를 받아온다.
  ///
  /// 현재 백엔드에 정식 `/api/recommend/refresh`가 구현되기 전까지는
  /// `/api/recommend`를 재호출하여 임시 대응한다. 감정/처방은 세션에 캐시되어
  /// 있으므로 Stage 3(벡터 검색 + 필터)만 재실행되어 결과가 달라질 수 있다.
  static Future<RecommendResult> refresh({
    required String sessionId,
    required double lat,
    required double lng,
  }) async {
    // TODO: 백엔드에 POST /api/recommend/refresh 구현 후 교체
    return fetch(sessionId: sessionId, lat: lat, lng: lng);
  }
}
