import 'dart:async';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/gps_service.dart';
import '../services/supabase_service.dart';
import 'settings_screen.dart';

class DriverScreen extends StatefulWidget {
  const DriverScreen({Key? key}) : super(key: key);

  @override
  State<DriverScreen> createState() => _DriverScreenState();
}

class _DriverScreenState extends State<DriverScreen> {
  final TextEditingController _tokenController = TextEditingController();
  final GpsService _gpsService = GpsService();
  final SupabaseService _supabaseService = SupabaseService();

  bool _isTracking = false;
  bool _isConnected = false;
  String _currentVehicleId = '';
  
  Position? _currentPosition;
  double _speedKmh = 0.0;
  
  DateTime? _shiftStartTime;
  final List<Position> _sessionPath = [];

  StreamSubscription<Position>? _positionSubscription;

  @override
  void initState() {
    super.initState();
    _loadSavedToken();
  }

  Future<void> _loadSavedToken() async {
    final prefs = await SharedPreferences.getInstance();
    final savedToken = prefs.getString('driver_token');
    if (savedToken != null) {
      _tokenController.text = savedToken;
    }
  }

  Future<void> _saveToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('driver_token', token);
  }

  Future<void> _startShift() async {
    final rawToken = _tokenController.text.trim();
    if (rawToken.isEmpty) {
      _showErrorDialog("Error", "El token está vacío. Por favor ingrésalo.");
      return;
    }

    // 1. Authenticate / get vehicle ID
    setState(() => _isConnected = false); 
    
    try {
      final vId = await _supabaseService.getVehicleIdByToken(rawToken);
      if (vId == null) {
        _showErrorDialog("Denegado", "Token Inválido o Vehículo no encontrado en la Base de Datos.");
        return;
      }
      
      await _saveToken(rawToken);

      // 2. Request GPS Permission
      final hasPerm = await _gpsService.requestPermissions();
      if (!hasPerm) {
        _showErrorDialog("GPS Denegado", "Debes otorgar permisos de ubicación 'Siempre' para trabajar.");
        return;
      }

      // 3. Start stream
      setState(() {
        _currentVehicleId = vId;
        _isTracking = true;
        _isConnected = true;
        _shiftStartTime = DateTime.now();
        _sessionPath.clear();
      });

      _gpsService.startTracking();
    
    // Listen to our filtered stream
    _positionSubscription = _gpsService.positionStream.listen((Position pos) async {
      setState(() {
        _currentPosition = pos;
        // Speed in m/s to km/h
        _speedKmh = (pos.speed * 3.6);
        _sessionPath.add(pos);
      });

      // Send to Supabase
      bool success = await _supabaseService.insertPosition(
        vehicleId: _currentVehicleId,
        token: _tokenController.text, // passed for edge RPC/RLS usage
        latitude: pos.latitude,
        longitude: pos.longitude,
        speedKmh: _speedKmh,
        heading: pos.heading,
      );

      setState(() => _isConnected = success);
    });
    
    } catch (e) {
      _showErrorDialog("Error Crítico", "Fallo al iniciar el turno: $e");
      setState(() => _isConnected = false);
    }
  }

  void _stopShift() {
    if (!_isTracking) return;

    _gpsService.stopTracking();
    _positionSubscription?.cancel();

    // Calculate final metrics
    final totalDistance = _gpsService.calculateDistance(_sessionPath);
    final duration = DateTime.now().difference(_shiftStartTime!);

    setState(() {
      _isTracking = false;
      _isConnected = false;
    });

    _showSummaryDialog(totalDistance, duration);
  }

  void _showSummaryDialog(double distanceMs, Duration duration) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text("Shift Summary"),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("⏱️ Time: ${duration.inHours}h ${duration.inMinutes.remainder(60)}m"),
            Text("📏 Distance: ${(distanceMs / 1000).toStringAsFixed(2)} km"),
            Text("📍 Total Signals Emitted: ${_sessionPath.length}"),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text("OK"),
          )
        ],
      ),
    );
  }

  void _showSnackbar(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  void _showErrorDialog(String title, String msg) {
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title, style: const TextStyle(color: Colors.red)),
        content: Text(msg),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text("OK"))
        ],
      ),
    );
  }

  void _promptAdminPin() {
    final TextEditingController pinCtrl = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text("Acceso Administrativo"),
        content: TextField(
          controller: pinCtrl,
          keyboardType: TextInputType.number,
          obscureText: true,
          decoration: const InputDecoration(labelText: "PIN (ej: 2024)"),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text("Cancelar")),
          TextButton(
            onPressed: () {
              if (pinCtrl.text == "2024") {
                Navigator.pop(ctx);
                Navigator.push(context, MaterialPageRoute(builder: (c) => const SettingsScreen()));
              } else {
                Navigator.pop(ctx);
                _showSnackbar("PIN Incorrecto");
              }
            }, 
            child: const Text("INGRESAR")
          ),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _positionSubscription?.cancel();
    _gpsService.stopTracking();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: GestureDetector(
          onLongPress: _promptAdminPin,
          child: const Text("TunjaBus Driver"),
        ),
        backgroundColor: Colors.blueAccent,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings, color: Colors.white70),
            onPressed: _promptAdminPin,
          )
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            const Icon(Icons.directions_bus, size: 80, color: Colors.blueAccent),
            const SizedBox(height: 20),
            TextField(
              controller: _tokenController,
              decoration: const InputDecoration(
                labelText: "Driver Token",
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.key),
              ),
              enabled: !_isTracking,
              obscureText: true,
            ),
            const SizedBox(height: 30),
            
            // Connection Status
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 20),
              decoration: BoxDecoration(
                color: _isTracking 
                  ? (_isConnected ? Colors.green.shade100 : Colors.orange.shade100)
                  : Colors.grey.shade200,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    _isTracking ? (_isConnected ? Icons.cloud_done : Icons.cloud_off) : Icons.stop_circle,
                    color: _isTracking ? (_isConnected ? Colors.green : Colors.orange) : Colors.grey,
                  ),
                  const SizedBox(width: 10),
                  Text(
                    _isTracking ? (_isConnected ? "Connected / Sending" : "No Signal") : "Standby",
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  )
                ],
              ),
            ),
            
            const SizedBox(height: 30),
            
            // Telemetry
            if (_isTracking) ...[
              Text(
                "${_speedKmh.toStringAsFixed(1)} km/h",
                style: const TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: Colors.black87),
              ),
              const SizedBox(height: 10),
              if (_currentPosition != null) ...[
                Text("Lat: ${_currentPosition!.latitude.toStringAsFixed(5)}", style: const TextStyle(fontSize: 16)),
                Text("Lon: ${_currentPosition!.longitude.toStringAsFixed(5)}", style: const TextStyle(fontSize: 16)),
                Text("Heading: ${_currentPosition!.heading.toStringAsFixed(1)}°", style: const TextStyle(fontSize: 16)),
              ]
            ],

            const Spacer(),

            // Big Action Button
            SizedBox(
              width: double.infinity,
              height: 70,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _isTracking ? Colors.redAccent : Colors.greenAccent.shade700,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                ),
                onPressed: _isTracking ? _stopShift : _startShift,
                child: Text(
                  _isTracking ? "STOP SHIFT" : "START SHIFT",
                  style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}
