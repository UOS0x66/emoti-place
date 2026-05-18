import 'package:flutter/material.dart';
import '../services/recommend_service.dart';
import '../services/saved_place_service.dart';
import '../widgets/place_card.dart';
import 'map_screen.dart';

class SavedPlacesScreen extends StatefulWidget {
  final Color accentColor;

  const SavedPlacesScreen({super.key, required this.accentColor});

  @override
  State<SavedPlacesScreen> createState() => _SavedPlacesScreenState();
}

class _SavedPlacesScreenState extends State<SavedPlacesScreen> {
  bool _loading = true;
  String? _error;
  List<RecommendedPlace> _places = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final places = await SavedPlaceService.list();
      if (!mounted) return;
      setState(() {
        _places = places;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _remove(RecommendedPlace p) async {
    final messenger = ScaffoldMessenger.of(context);
    final prev = _places;
    setState(() {
      _places = _places.where((x) => x.placeId != p.placeId).toList();
    });
    try {
      await SavedPlaceService.unsave(placeId: p.placeId);
    } catch (e) {
      if (mounted) setState(() => _places = prev);
      messenger.showSnackBar(
        SnackBar(
          content: Text('삭제 실패: $e'),
          backgroundColor: const Color(0xFF333333),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1A1A1A),
        foregroundColor: Colors.white,
        elevation: 1,
        title: Text(
          '내 보관함',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: widget.accentColor,
          ),
        ),
        actions: [
          IconButton(
            tooltip: '새로고침',
            icon: Icon(Icons.refresh, color: widget.accentColor),
            onPressed: _loading ? null : _load,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return Center(
        child: CircularProgressIndicator(color: widget.accentColor),
      );
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            '보관함을 불러오지 못했습니다.\n$_error',
            textAlign: TextAlign.center,
            style: const TextStyle(color: Color(0xFFAAAAAA)),
          ),
        ),
      );
    }
    if (_places.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            '아직 보관한 장소가 없습니다.\n추천 카드에서 북마크 아이콘을 눌러 저장해보세요.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Color(0xFFAAAAAA), height: 1.5),
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      itemCount: _places.length,
      itemBuilder: (context, index) {
        final place = _places[index];
        return PlaceCard(
          name: place.name,
          category: place.category,
          address: place.address,
          photoUrl: place.photo,
          atmosphereText: place.displayDescription,
          operatingHours: place.operatingHoursText,
          maxGroupSize: place.maxGroupSize,
          isOutdoor: place.isOutdoor,
          personaReason: place.reason,
          accentColor: widget.accentColor,
          saved: true,
          onSavedChanged: (_) async => _remove(place),
          onMapTap: () {
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => MapScreen(
                  placeName: place.name,
                  address: place.address,
                  lat: place.lat,
                  lng: place.lng,
                ),
              ),
            );
          },
        );
      },
    );
  }
}
