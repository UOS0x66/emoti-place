import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_naver_map/flutter_naver_map.dart';
import 'package:permission_handler/permission_handler.dart';
import 'screens/splash_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await dotenv.load(fileName: '.env');

  await FlutterNaverMap().init(
    clientId: dotenv.env['NAVER_MAP_CLIENT_ID']!,
  );

  // 위치 권한이 없으면 다이얼로그를 띄우고, 거절(또는 영구 거절) 시 앱 종료.
  // 정책: 위치 권한 없이는 앱 진입 불가. 다음 실행 때 OS가 다시 다이얼로그를
  // 띄워준다(영구 거절 단계까지 가면 OS 자체가 다이얼로그를 안 띄우는데,
  // 그 경우에도 동일하게 종료).
  if (!await _ensureLocationPermission()) {
    await SystemNavigator.pop();
    return;
  }

  runApp(const EmotiPlaceApp());
}

Future<bool> _ensureLocationPermission() async {
  var status = await Permission.location.status;
  if (status.isGranted || status.isLimited) return true;
  status = await Permission.location.request();
  return status.isGranted || status.isLimited;
}

class EmotiPlaceApp extends StatelessWidget {
  const EmotiPlaceApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EmotiPlace',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFFF6B35)),
        fontFamily: 'Pretendard',
      ),
      home: const SplashScreen(),
    );
  }
}
