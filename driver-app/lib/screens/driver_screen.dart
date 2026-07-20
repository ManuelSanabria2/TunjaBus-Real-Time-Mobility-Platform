import 'dart:async';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../services/gps_service.dart';
import '../services/offline_queue.dart';
import '../services/supabase_service.dart';
import 'settings_screen.dart';

/// Estado de transmisión visible para el conductor. `flushing` = hay red y se
/// está drenando la cola de puntos acumulados offline.
enum TxStatus { standby, sending, flushing, noNetwork, invalidToken }

class DriverScreen extends StatefulWidget {
  const DriverScreen({super.key});

  @override
  State<DriverScreen> createState() => _DriverScreenState();
}

class _DriverScreenState extends State<DriverScreen> {
  final TextEditingController _tokenController = TextEditingController();
  final GpsService _gpsService = GpsService();
  final SupabaseService _supabaseService = SupabaseService();
  late final PositionSenderService _sender;

  bool _isTracking = false;
  TxStatus _txStatus = TxStatus.standby;
  int _queueLength = 0;
  bool _invalidTokenNotified = false;

  Position? _currentPosition;
  double _speedKmh = 0.0;

  DateTime? _shiftStartTime;
  final List<Position> _sessionPath = [];

  StreamSubscription<Position>? _positionSubscription;

  @override
  void initState() {
    super.initState();
    _sender = PositionSenderService(_supabaseService);
    _sender.onInvalidToken = _handleInvalidToken;
    _sender.addListener(_onSenderChanged);
    _sender.init();
    _loadSavedToken();
  }

  /// El estado visible se deriva del sender: cola pendiente y conectividad.
  void _onSenderChanged() {
    if (!mounted) return;
    setState(() {
      _queueLength = _sender.queueLength;
      if (_txStatus == TxStatus.invalidToken) return; // lo maneja el diálogo
      if (!_sender.isOnline) {
        _txStatus = TxStatus.noNetwork;
      } else if (_queueLength > 0) {
        _txStatus = TxStatus.flushing;
      } else if (_isTracking) {
        _txStatus = TxStatus.sending;
      } else {
        _txStatus = TxStatus.standby;
      }
    });
  }

  void _handleInvalidToken() {
    if (_invalidTokenNotified) return;
    _invalidTokenNotified = true;
    _sender.pause(); // conserva la cola; reanuda al iniciar turno con token válido
    _stopTrackingInternal();
    if (mounted) setState(() => _txStatus = TxStatus.invalidToken);
    _showErrorDialog(
      'Token inválido',
      'El servidor rechazó el token. Los puntos en cola se conservan y se '
          'enviarán cuando inicies turno con un token válido.',
    );
  }

  // The plaintext token lives only on the device (the driver needs it to sign
  // each RPC call). It is never persisted plaintext in the database.
  Future<void> _loadSavedToken() async {
    final prefs = await SharedPreferences.getInstance();
    final savedToken = prefs.getString('driver_token');
    if (savedToken != null && mounted) {
      _tokenController.text = savedToken;
    }
  }

  Future<void> _saveToken(String token) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('driver_token', token);
  }

  Future<void> _startShift() async {
    final token = _tokenController.text.trim();
    if (token.isEmpty) {
      _showErrorDialog('Error', 'El token está vacío. Por favor ingrésalo.');
      return;
    }

    final hasPerm = await _gpsService.requestPermissions();
    if (!hasPerm) {
      _showErrorDialog(
        'GPS Denegado',
        "Debes otorgar permisos de ubicación 'Siempre' para trabajar.",
      );
      return;
    }

    await _saveToken(token);

    setState(() {
      _isTracking = true;
      _txStatus = TxStatus.sending;
      _invalidTokenNotified = false;
      _shiftStartTime = DateTime.now();
      _sessionPath.clear();
    });

    // Arranca (o reanuda) el drenaje de la cola con el token vigente. Si
    // quedaron puntos de un turno anterior, salen primero (orden FIFO).
    _sender.start(token);

    _gpsService.startTracking();

    _positionSubscription = _gpsService.positionStream.listen((Position pos) {
      // geolocator returns -1 for unknown speed/heading; normalize (M2).
      final speedKmh = pos.speed >= 0 ? pos.speed * 3.6 : 0.0;
      final heading = (pos.heading >= 0 && pos.heading <= 360) ? pos.heading : 0.0;

      setState(() {
        _currentPosition = pos;
        _speedKmh = speedKmh;
        _sessionPath.add(pos);
      });

      // Todo envío pasa por la cola FIFO persistente: con red sale de
      // inmediato (respetando el rate limit de 1/s); sin red queda en Hive y
      // se reenvía al reconectar, con su hora de captura real.
      _sender.submit(QueuedPosition(
        latitude: pos.latitude,
        longitude: pos.longitude,
        speedKmh: speedKmh,
        heading: heading,
        capturedAt: pos.timestamp,
      ));
    });
  }

  void _stopTrackingInternal() {
    _gpsService.stopTracking();
    _positionSubscription?.cancel();
    _positionSubscription = null;
    if (mounted) {
      setState(() {
        _isTracking = false;
        _txStatus = TxStatus.standby;
      });
    }
  }

  void _stopShift() {
    if (!_isTracking) return;

    final totalDistance = _gpsService.calculateDistance(_sessionPath);
    final duration = DateTime.now().difference(_shiftStartTime!);

    _stopTrackingInternal();
    _showSummaryDialog(totalDistance, duration);
  }

  void _showSummaryDialog(double distanceMs, Duration duration) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Resumen del Turno'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('⏱️ Tiempo: ${duration.inHours}h ${duration.inMinutes.remainder(60)}m'),
            Text('📏 Distancia: ${(distanceMs / 1000).toStringAsFixed(2)} km'),
            Text('📍 Señales emitidas: ${_sessionPath.length}'),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK')),
        ],
      ),
    );
  }

  void _showErrorDialog(String title, String msg) {
    if (!mounted) return;
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title, style: const TextStyle(color: Color(0xFFB5603A))),
        content: Text(msg),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('OK')),
        ],
      ),
    );
  }

  @override
  void dispose() {
    _positionSubscription?.cancel();
    _gpsService.stopTracking();
    _sender.removeListener(_onSenderChanged);
    _sender.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  // Nota: sin el early-return por !_isTracking de antes — la cola puede seguir
  // drenando (flushing) después de terminar el turno y debe seguir visible.
  ({String label, IconData icon, Color color}) _statusVisuals() {
    switch (_txStatus) {
      case TxStatus.sending:
        return (label: 'Conectado / Enviando', icon: Icons.cloud_done, color: const Color(0xFF5C8265));
      case TxStatus.flushing:
        return (
          label: 'Enviando cola — $_queueLength pendiente${_queueLength == 1 ? '' : 's'}',
          icon: Icons.cloud_sync,
          color: const Color(0xFF5C8265),
        );
      case TxStatus.noNetwork:
        return (
          label: _queueLength > 0
              ? 'Sin conexión — $_queueLength punto${_queueLength == 1 ? '' : 's'} en cola'
              : 'Sin señal (reintentando)',
          icon: Icons.cloud_off,
          color: const Color(0xFFB5603A),
        );
      case TxStatus.invalidToken:
        return (label: 'Token inválido', icon: Icons.gpp_bad, color: const Color(0xFFB5603A));
      case TxStatus.standby:
        return (label: 'En espera', icon: Icons.stop_circle, color: const Color(0xFF8C867E));
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = _statusVisuals();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Andén Drivers'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings, color: Colors.white70),
            tooltip: 'Ajustes GPS',
            onPressed: _isTracking
                ? null
                : () => Navigator.push(
                      context,
                      MaterialPageRoute(builder: (c) => const SettingsScreen()),
                    ),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          children: [
            SvgPicture.asset('assets/images/anden-conductor-dark.svg', height: 70),
            const SizedBox(height: 20),
            TextField(
              controller: _tokenController,
              enabled: !_isTracking,
              obscureText: true,
              decoration: const InputDecoration(
                labelText: 'Driver Token',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.key),
              ),
            ),
            const SizedBox(height: 30),

            // Connection status
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 20),
              decoration: BoxDecoration(
                color: status.color.withOpacity(0.13),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(status.icon, color: status.color),
                  const SizedBox(width: 10),
                  Text(
                    status.label,
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: status.color),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 30),

            // Telemetry
            if (_isTracking) ...[
              Text(
                '${_speedKmh.toStringAsFixed(1)} km/h',
                style: const TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: Colors.black87),
              ),
              const SizedBox(height: 10),
              if (_currentPosition != null) ...[
                Text('Lat: ${_currentPosition!.latitude.toStringAsFixed(5)}', style: const TextStyle(fontSize: 16)),
                Text('Lon: ${_currentPosition!.longitude.toStringAsFixed(5)}', style: const TextStyle(fontSize: 16)),
                Text('Heading: ${_currentPosition!.heading.toStringAsFixed(1)}°', style: const TextStyle(fontSize: 16)),
              ],
            ],

            const Spacer(),

            // Big action button
            SizedBox(
              width: double.infinity,
              height: 70,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(
                  backgroundColor: _isTracking ? const Color(0xFFB5603A) : const Color(0xFF5C8265),
                  foregroundColor: const Color(0xFFF3EFE9),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(15)),
                ),
                onPressed: _isTracking ? _stopShift : _startShift,
                child: Text(
                  _isTracking ? 'TERMINAR TURNO' : 'INICIAR TURNO',
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
