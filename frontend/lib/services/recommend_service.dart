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
    this.operatingHours,
    this.maxGroupSize,
    this.isOutdoor = false,
    this.reason,
    this.psychRationale,
    this.similarity = 0,
  });

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
      distance: (json['distance'] as num?)?.toDouble() ?? 0,
      atmosphereText: json['atmosphere_text'] as String?,
      operatingHours: json['operating_hours'],
      maxGroupSize: json['max_group_size'] as int?,
      isOutdoor: (json['is_outdoor'] ?? false) as bool,
      reason: json['reason'] as String?,
      psychRationale: json['psych_rationale'] as String?,
      similarity: (json['similarity'] as num?)?.toDouble() ?? 0,
    );
  }
}

class RecommendService {
  static Future<List<RecommendedPlace>> fetch({
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
    return list.map(RecommendedPlace.fromJson).toList();
  }

  /// 같은 세션에 대해 다음 배치의 추천 장소를 받아온다.
  ///
  /// 현재 백엔드에 정식 `/api/recommend/refresh`가 구현되기 전까지는
  /// `/api/recommend`를 재호출하여 임시 대응한다. 감정/처방은 세션에 캐시되어
  /// 있으므로 Stage 3(벡터 검색 + 필터)만 재실행되어 결과가 달라질 수 있다.
  static Future<List<RecommendedPlace>> refresh({
    required String sessionId,
    required double lat,
    required double lng,
  }) async {
    // TODO: 백엔드에 POST /api/recommend/refresh 구현 후 교체
    return fetch(sessionId: sessionId, lat: lat, lng: lng);
  }
}
