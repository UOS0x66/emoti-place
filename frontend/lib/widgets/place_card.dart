import 'package:flutter/material.dart';

class PlaceCard extends StatelessWidget {
  final String name;
  final String category;
  final String address;
  final String? atmosphereText;
  final String? operatingHours;
  final int? maxGroupSize;
  final bool isOutdoor;
  final String? personaReason;
  final Color accentColor;
  final VoidCallback? onMapTap;

  const PlaceCard({
    super.key,
    required this.name,
    required this.category,
    required this.address,
    this.atmosphereText,
    this.operatingHours,
    this.maxGroupSize,
    this.isOutdoor = false,
    this.personaReason,
    required this.accentColor,
    this.onMapTap,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      constraints: BoxConstraints(
        maxWidth: MediaQuery.of(context).size.width * 0.8,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFF1E1E1E),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: accentColor.withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 사진 플레이스홀더
          Container(
            height: 140,
            decoration: BoxDecoration(
              color: const Color(0xFF2A2A2A),
              borderRadius: const BorderRadius.only(
                topLeft: Radius.circular(16),
                topRight: Radius.circular(16),
              ),
            ),
            child: Center(
              child: Icon(
                isOutdoor ? Icons.park_outlined : Icons.store_outlined,
                size: 48,
                color: accentColor.withValues(alpha: 0.5),
              ),
            ),
          ),

          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 장소명
                Text(
                  name,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: accentColor,
                  ),
                ),
                const SizedBox(height: 8),

                // 카테고리
                _InfoRow(icon: Icons.label_outline, text: category),
                const SizedBox(height: 4),

                // 주소
                _InfoRow(icon: Icons.place_outlined, text: address),

                // 영업시간
                if (operatingHours != null) ...[
                  const SizedBox(height: 4),
                  _InfoRow(icon: Icons.access_time, text: operatingHours!),
                ],

                // 최대 인원
                if (maxGroupSize != null) ...[
                  const SizedBox(height: 4),
                  _InfoRow(icon: Icons.group_outlined, text: '최대 $maxGroupSize명'),
                ],

                // 실내/실외
                const SizedBox(height: 4),
                _InfoRow(
                  icon: isOutdoor ? Icons.wb_sunny_outlined : Icons.roofing,
                  text: isOutdoor ? '실외' : '실내',
                ),

                // 분위기
                if (atmosphereText != null) ...[
                  const SizedBox(height: 10),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: accentColor.withValues(alpha: 0.08),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '"$atmosphereText"',
                      style: const TextStyle(
                        fontSize: 13,
                        fontStyle: FontStyle.italic,
                        color: Color(0xFFBBBBBB),
                        height: 1.4,
                      ),
                    ),
                  ),
                ],

                // 페르소나 추천 사유
                if (personaReason != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    personaReason!,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFF999999),
                      height: 1.4,
                    ),
                  ),
                ],

                // 지도 버튼
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: onMapTap,
                    icon: const Icon(Icons.map_outlined, size: 18),
                    label: const Text('지도에서 보기'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: accentColor,
                      side: BorderSide(color: accentColor.withValues(alpha: 0.5)),
                      padding: const EdgeInsets.symmetric(vertical: 10),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(10),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String text;

  const _InfoRow({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 15, color: const Color(0xFF888888)),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            text,
            style: const TextStyle(
              fontSize: 13,
              color: Color(0xFFAAAAAA),
            ),
          ),
        ),
      ],
    );
  }
}
