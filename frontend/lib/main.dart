import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import 'screens/splash_screen.dart';
import 'screens/permission_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

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
