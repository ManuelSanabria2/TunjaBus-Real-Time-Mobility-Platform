import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'supabase_service.dart';

/// Punto GPS pendiente de envío, persistido en Hive con su hora de CAPTURA
/// (no la de envío): el RPC lo registra con `captured_at` aunque llegue tarde.
class QueuedPosition {
  final double latitude;
  final double longitude;
  final double speedKmh;
  final double heading;
  final DateTime capturedAt;

  QueuedPosition({
    required this.latitude,
    required this.longitude,
    required this.speedKmh,
    required this.heading,
    required this.capturedAt,
  });

  Map<String, dynamic> toMap() => {
        'lat': latitude,
        'lon': longitude,
        'speed': speedKmh,
        'heading': heading,
        'captured_at': capturedAt.toUtc().toIso8601String(),
      };

  factory QueuedPosition.fromMap(Map<dynamic, dynamic> map) => QueuedPosition(
        latitude: (map['lat'] as num).toDouble(),
        longitude: (map['lon'] as num).toDouble(),
        speedKmh: (map['speed'] as num).toDouble(),
        heading: (map['heading'] as num).toDouble(),
        capturedAt: DateTime.parse(map['captured_at'] as String),
      );
}

/// Cola FIFO única por la que pasa TODO envío de posición (en vivo y offline).
///
/// Por qué una sola cola y no "envío directo + cola de respaldo": el servidor
/// descarta EN SILENCIO todo lo que supere 1 insert/segundo por vehículo
/// (devuelve 'ok' igualmente). Si el flujo en vivo y el drenaje de la cola
/// compitieran, los descartes serían invisibles. Serializando todo por una
/// FIFO con espaciado >= 1.1 s:
///   * se respeta el rate limit sin pérdidas encubiertas,
///   * el orden cronológico se preserva (Realtime recibe los puntos en orden),
///   * "offline" es simplemente una cola que crece hasta que vuelva la red.
///
/// La cola vive en Hive: sobrevive cierres de la app y cortes de batería.
class PositionSenderService extends ChangeNotifier {
  PositionSenderService(this._supabase);

  final SupabaseService _supabase;

  static const String _boxName = 'position_queue';

  /// ~5.5 horas de datos a 1 punto/seg. Al llenarse se pierde lo MÁS VIEJO.
  static const int maxQueueLength = 20000;

  /// Tick del drenaje. 1.2 s deja margen sobre el límite de 1/s del servidor.
  static const Duration _pumpInterval = Duration(milliseconds: 1200);
  static const Duration _minSendSpacing = Duration(milliseconds: 1100);

  Box? _box;
  Timer? _pumpTimer;
  bool _sending = false;
  bool _online = true;
  String? _token;
  DateTime _lastSendAt = DateTime.fromMillisecondsSinceEpoch(0);

  /// Lo dispara el primer 'invalid_token' del servidor; la pantalla decide
  /// (detener turno, pedir token). Los puntos NO se descartan: siguen siendo
  /// válidos cuando se ingrese un token correcto.
  VoidCallback? onInvalidToken;

  int get queueLength => _box?.length ?? 0;
  bool get isOnline => _online;

  Future<void> init() async {
    _box ??= await Hive.openBox(_boxName);
    notifyListeners();
  }

  /// Arranca (o re-arranca) el drenaje con el token vigente. El pump corre
  /// mientras el servicio viva: terminar el turno no detiene el drenaje de lo
  /// pendiente.
  void start(String token) {
    _token = token;
    _pumpTimer ??= Timer.periodic(_pumpInterval, (_) => _pump());
    _pump();
  }

  /// Suspende el envío (token inválido). La cola queda intacta en Hive.
  void pause() {
    _token = null;
  }

  /// Encola un punto. Si hay red y el cooldown lo permite, sale de inmediato.
  void submit(QueuedPosition position) {
    final box = _box;
    if (box == null) return;
    if (box.length >= maxQueueLength) {
      box.deleteAt(0);
    }
    box.add(position.toMap());
    notifyListeners();
    _pump();
  }

  Future<void> _pump() async {
    final box = _box;
    if (box == null || _sending || box.isEmpty || _token == null) return;
    if (DateTime.now().difference(_lastSendAt) < _minSendSpacing) return;

    _sending = true;
    try {
      final raw = box.getAt(0);
      final point = QueuedPosition.fromMap(raw as Map);

      final status = await _supabase.insertVehiclePosition(
        token: _token!,
        latitude: point.latitude,
        longitude: point.longitude,
        speedKmh: point.speedKmh,
        heading: point.heading,
        capturedAt: point.capturedAt,
      );
      _lastSendAt = DateTime.now();
      _online = true;

      if (status == 'invalid_token') {
        onInvalidToken?.call();
      } else {
        // 'ok' => procesado. 'out_of_range' / 'invalid_timestamp' => inválido
        // de forma permanente: reintentarlo jamás tendrá éxito, se descarta.
        await box.deleteAt(0);
      }
    } catch (_) {
      // Error de red/transporte: el punto se conserva y el siguiente tick del
      // pump reintenta. Este catch ES la detección de "sin conexión".
      _online = false;
    } finally {
      _sending = false;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _pumpTimer?.cancel();
    _pumpTimer = null;
    super.dispose();
  }
}
