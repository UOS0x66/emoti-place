import 'package:flutter/material.dart';
import 'screens/splash_screen.dart';

void main() {
  runApp(const EmotiPlaceApp());
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
