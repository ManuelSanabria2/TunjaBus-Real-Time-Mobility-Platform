import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'screens/driver_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // Load environment variables
  await dotenv.load(fileName: ".env");

  // Initialize Supabase Local Client
  await Supabase.initialize(
    url: dotenv.env['SUPABASE_URL']!,
    anonKey: dotenv.env['SUPABASE_ANON_KEY']!,
  );

  runApp(const DriverApp());
}

class DriverApp extends StatelessWidget {
  const DriverApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Andén Drivers',
      theme: ThemeData(
        scaffoldBackgroundColor: const Color(0xFFF3EFE9), // Piedra
        colorScheme: ColorScheme.light(
          primary: const Color(0xFFB5603A), // Terracota
          onPrimary: const Color(0xFFF3EFE9), // Piedra
          secondary: const Color(0xFF5C8265), // Salvia
          onSecondary: const Color(0xFFF3EFE9), // Piedra
          surface: Colors.white,
          onSurface: const Color(0xFF1C2632), // Tinta
          background: const Color(0xFFF3EFE9), // Piedra
          onBackground: const Color(0xFF1C2632), // Tinta
        ),
        appBarTheme: const AppBarTheme(
          backgroundColor: Color(0xFF1C2632), // Tinta
          foregroundColor: Color(0xFFF3EFE9), // Piedra
          elevation: 0,
        ),
        useMaterial3: true,
      ),
      home: DriverScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}
