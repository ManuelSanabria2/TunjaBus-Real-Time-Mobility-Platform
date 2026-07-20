import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'screens/driver_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Load environment variables
  await dotenv.load(fileName: ".env");

  // Almacenamiento local de la cola offline de posiciones.
  await Hive.initFlutter();

  // Initialize Supabase with the anon key. Position writes are authorized by a
  // per-vehicle token validated inside the insert_vehicle_position RPC, not by
  // a user session.
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
      home: const DriverScreen(),
      builder: (context, child) {
        return Stack(
          children: [
            if (child != null) child,
            Positioned(
              bottom: 8,
              left: 0,
              right: 0,
              child: IgnorePointer(
                child: Center(
                  child: Text(
                    'hecho por manuel jose sanabria gil',
                    style: TextStyle(
                      fontSize: 11,
                      color: Colors.grey.withOpacity(0.6),
                      decoration: TextDecoration.none,
                      fontWeight: FontWeight.normal,
                    ),
                  ),
                ),
              ),
            ),
          ],
        );
      },
      debugShowCheckedModeBanner: false,
    );
  }
}
