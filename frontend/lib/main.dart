import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:flutter_naver_map/flutter_naver_map.dart';
import 'package:permission_handler/permission_handler.dart';
import 'screens/splash_screen.dart';
import 'screens/permission_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await dotenv.load(fileName: '.env');

  await FlutterNaverMap().init(
    clientId: dotenv.env['NAVER_MAP_CLIENT_ID']!,
  );

  final locationStatus = await Permission.location.status;

  runApp(EmotiPlaceApp(locationGranted: locationStatus.isGranted));
}

class EmotiPlaceApp extends StatelessWidget {
  final bool locationGranted;

  const EmotiPlaceApp({super.key, required this.locationGranted});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EmotiPlace',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFFF6B35)),
        fontFamily: 'Pretendard',
      ),
      home: locationGranted ? const SplashScreen() : const PermissionScreen(),
    );
  }
}
