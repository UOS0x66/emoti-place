import 'package:flutter/material.dart';
import '../services/feedback_service.dart';

/// 카드에서 사용자가 누른 평점. null = 미평가.
typedef RatingCallback = Future<void> Function(PlaceRating? newRating);

/// 보관함 토글 콜백. 새 상태 (true = 보관, false = 해제) 가 전달된다.
typedef SavedCallback = Future<void> Function(bool nextSaved);

class PlaceCard extends StatefulWidget {
  final String name;
  final String category;
  final String address;
  final String? photoUrl;
  final String? atmosphereText;
  final String? operatingHours;
  final int? maxGroupSize;
  final bool isOutdoor;
  final String? personaReason;
  final Color accentColor;
  final double? distanceKm;
  final VoidCallback? onMapTap;
  final RatingCallback? onRatingChanged;
  // 부모가 보유하는 평점 — ListView 가 카드 위젯을 destroy/recreate 해도 부모 state 는 살아있다.
  // 그래서 카드 자체는 이걸 읽기만 하고, 변경은 onRatingChanged 콜백으로 위임한다.
  final PlaceRating? rating;
  // 보관함 상태 (부모 state 가 source of truth).
  final bool saved;
  final SavedCallback? onSavedChanged;

  const PlaceCard({
    super.key,
    required this.name,
    required this.category,
    required this.address,
    this.photoUrl,
    this.atmosphereText,
    this.operatingHours,
    this.maxGroupSize,
    this.isOutdoor = false,
    this.personaReason,
    required this.accentColor,
    this.distanceKm,
    this.onMapTap,
    this.onRatingChanged,
    this.rating,
    this.saved = false,
    this.onSavedChanged,
  });

  @override
  State<PlaceCard> createState() => _PlaceCardState();
}

class _PlaceCardState extends State<PlaceCard> {
  // 진행 중 표시만 로컬 — 네트워크 요청 중에 같은 버튼을 다시 못 누르도록.
  // 그러나 화면 밖으로 스크롤되어 State 가 destroy 되면 자연히 사라지고,
  // 결과 자체는 부모 state 에 반영되므로 다시 그릴 때 정확한 상태로 보인다.
  bool _ratingBusy = false;
  bool _savedBusy = false;
  bool _descExpanded = false;
  // 카드 전체 펼침 상태. 기본은 collapsed (사진 + 이름만). 탭 시 토글.
  bool _cardExpanded = false;

  Future<void> _toggle(PlaceRating tapped) async {
    if (_ratingBusy || widget.onRatingChanged == null) return;
    final next = widget.rating == tapped ? null : tapped; // 같은 버튼 다시 누르면 해제
    setState(() => _ratingBusy = true);
    try {
      await widget.onRatingChanged!(next);
    } finally {
      if (mounted) setState(() => _ratingBusy = false);
    }
  }

  Future<void> _toggleSaved() async {
    if (_savedBusy || widget.onSavedChanged == null) return;
    setState(() => _savedBusy = true);
    try {
      await widget.onSavedChanged!(!widget.saved);
    } finally {
      if (mounted) setState(() => _savedBusy = false);
    }
  }

  String _formatDistance(double km) {
    if (km < 1) return '${(km * 1000).round()}m';
    return '${km.toStringAsFixed(1)}km';
  }

  Widget _buildPhotoArea() {
    final placeholder = Container(
      decoration: const BoxDecoration(color: Color(0xFF2A2A2A)),
      child: Center(
        child: Icon(
          widget.isOutdoor ? Icons.park_outlined : Icons.store_outlined,
          size: 48,
          color: widget.accentColor.withValues(alpha: 0.5),
        ),
      ),
    );

    final url = widget.photoUrl;
    final imageWidget = (url != null && url.isNotEmpty)
        ? Image.network(
            url,
            fit: BoxFit.cover,
            width: double.infinity,
            height: 140,
            errorBuilder: (_, __, ___) => placeholder,
            loadingBuilder: (context, child, progress) {
              if (progress == null) return child;
              return Container(
                color: const Color(0xFF2A2A2A),
                alignment: Alignment.center,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: widget.accentColor.withValues(alpha: 0.5),
                ),
              );
            },
          )
        : placeholder;

    return ClipRRect(
      borderRadius: const BorderRadius.only(
        topLeft: Radius.circular(16),
        topRight: Radius.circular(16),
      ),
      child: SizedBox(height: 140, width: double.infinity, child: imageWidget),
    );
  }

  Widget _buildRatingRow() {
    if (widget.onRatingChanged == null) return const SizedBox.shrink();
    final liked = widget.rating == PlaceRating.like;
    final disliked = widget.rating == PlaceRating.dislike;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        children: [
          _RatingButton(
            icon: liked ? Icons.thumb_up : Icons.thumb_up_outlined,
            label: '좋아요',
            active: liked,
            activeColor: widget.accentColor,
            onTap: _ratingBusy ? null : () => _toggle(PlaceRating.like),
          ),
          const SizedBox(width: 8),
          _RatingButton(
            icon: disliked ? Icons.thumb_down : Icons.thumb_down_outlined,
            label: '싫어요',
            active: disliked,
            activeColor: const Color(0xFFE57373),
            onTap: _ratingBusy ? null : () => _toggle(PlaceRating.dislike),
          ),
          if (_ratingBusy) ...[
            const SizedBox(width: 8),
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: widget.accentColor.withValues(alpha: 0.5),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildDescription() {
    final text = widget.atmosphereText;
    if (text == null || text.isEmpty) return const SizedBox.shrink();
    final canCollapse = text.length > 30; // 30자 미만이면 토글 없이 그냥 1줄로 끝.
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: widget.accentColor.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '"$text"',
              maxLines: _descExpanded ? null : 1,
              overflow: _descExpanded ? TextOverflow.visible : TextOverflow.ellipsis,
              style: const TextStyle(
                fontSize: 13,
                fontStyle: FontStyle.italic,
                color: Color(0xFFBBBBBB),
                height: 1.4,
              ),
            ),
            if (canCollapse)
              GestureDetector(
                onTap: () => setState(() => _descExpanded = !_descExpanded),
                behavior: HitTestBehavior.opaque,
                child: Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Row(
                    children: [
                      Text(
                        _descExpanded ? '간단히' : '자세히',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: widget.accentColor.withValues(alpha: 0.9),
                        ),
                      ),
                      Icon(
                        _descExpanded ? Icons.expand_less : Icons.expand_more,
                        size: 16,
                        color: widget.accentColor.withValues(alpha: 0.9),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    final saveBtn = widget.onSavedChanged == null
        ? null
        : IconButton(
            onPressed: _savedBusy ? null : _toggleSaved,
            tooltip: widget.saved ? '보관함에서 빼기' : '보관함에 저장',
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
            icon: _savedBusy
                ? SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: widget.accentColor.withValues(alpha: 0.7),
                    ),
                  )
                : Icon(
                    widget.saved ? Icons.bookmark : Icons.bookmark_border,
                    size: 22,
                    color: widget.saved
                        ? widget.accentColor
                        : const Color(0xFF888888),
                  ),
          );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            widget.name,
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: widget.accentColor,
            ),
          ),
        ),
        ?saveBtn,
      ],
    );
  }

  Widget _buildCollapsedBody() {
    return InkWell(
      onTap: () => setState(() => _cardExpanded = true),
      borderRadius: BorderRadius.circular(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildPhotoArea(),
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Text(
                    widget.name,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: widget.accentColor,
                    ),
                  ),
                ),
                Icon(
                  Icons.expand_more,
                  size: 22,
                  color: widget.accentColor.withValues(alpha: 0.7),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildExpandedBody() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // 사진 영역도 탭 시 접을 수 있게
        InkWell(
          onTap: () => setState(() => _cardExpanded = false),
          child: _buildPhotoArea(),
        ),
        Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 장소명 + 북마크 (헤더 탭으로 접기)
              GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTap: () => setState(() => _cardExpanded = false),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: _buildHeader()),
                    Icon(
                      Icons.expand_less,
                      size: 22,
                      color: widget.accentColor.withValues(alpha: 0.7),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),

              // 카테고리
              _InfoRow(icon: Icons.label_outline, text: widget.category),
              const SizedBox(height: 4),

              // 주소
              _InfoRow(icon: Icons.place_outlined, text: widget.address),

              // 거리 (현재 내 위치 기준)
              if (widget.distanceKm != null) ...[
                const SizedBox(height: 4),
                _InfoRow(
                  icon: Icons.directions_walk,
                  text: '내 위치에서 ${_formatDistance(widget.distanceKm!)}',
                ),
              ],

              // 영업시간
              if (widget.operatingHours != null) ...[
                const SizedBox(height: 4),
                _InfoRow(icon: Icons.access_time, text: widget.operatingHours!),
              ],

              // 최대 인원
              if (widget.maxGroupSize != null) ...[
                const SizedBox(height: 4),
                _InfoRow(icon: Icons.group_outlined, text: '최대 ${widget.maxGroupSize}명'),
              ],

              // 실내/실외
              const SizedBox(height: 4),
              _InfoRow(
                icon: widget.isOutdoor ? Icons.wb_sunny_outlined : Icons.roofing,
                text: widget.isOutdoor ? '실외' : '실내',
              ),

              // 분위기 (1줄 + 토글로 펼치기)
              _buildDescription(),

              // 페르소나 추천 사유
              if (widget.personaReason != null) ...[
                const SizedBox(height: 8),
                Text(
                  widget.personaReason!,
                  style: const TextStyle(
                    fontSize: 13,
                    color: Color(0xFF999999),
                    height: 1.4,
                  ),
                ),
              ],

              // LIKE / DISLIKE 토글
              _buildRatingRow(),

              // 지도 버튼
              const SizedBox(height: 12),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: widget.onMapTap,
                  icon: const Icon(Icons.map_outlined, size: 18),
                  label: const Text('지도에서 보기'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: widget.accentColor,
                    side: BorderSide(color: widget.accentColor.withValues(alpha: 0.5)),
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
    );
  }

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
          color: widget.accentColor.withValues(alpha: 0.3),
          width: 1,
        ),
      ),
      clipBehavior: Clip.antiAlias,
      child: _cardExpanded ? _buildExpandedBody() : _buildCollapsedBody(),
    );
  }
}

class _RatingButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final Color activeColor;
  final VoidCallback? onTap;

  const _RatingButton({
    required this.icon,
    required this.label,
    required this.active,
    required this.activeColor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final fg = active ? activeColor : const Color(0xFF888888);
    final border = active ? activeColor.withValues(alpha: 0.6) : const Color(0xFF333333);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: active ? activeColor.withValues(alpha: 0.12) : Colors.transparent,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: border, width: 1),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: fg),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(fontSize: 12, color: fg, fontWeight: FontWeight.w500),
            ),
          ],
        ),
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
