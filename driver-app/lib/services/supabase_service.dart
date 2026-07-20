import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseService {
  final SupabaseClient _client = Supabase.instance.client;

  /// Emit a position through the SECURITY DEFINER RPC. The server hashes the
  /// token with SHA-256 and looks it up against vehicles.token_hash; the
  /// vehicle_id is resolved inside the function. Direct INSERT into
  /// vehicle_positions is blocked by RLS, so this RPC is the only write path.
  ///
  /// Returns a status rather than raising, because the server has to commit its
  /// auth_failures log (a RAISE would roll that log back):
  ///   'ok'                -> accepted, or silently dropped by the server rate limit
  ///   'invalid_token'     -> the token did not authenticate
  ///   'out_of_range'      -> authenticated, but the coordinates were rejected
  ///   'invalid_timestamp' -> captured_at fuera de rango (>2 min futuro / >3 días)
  ///
  /// [capturedAt] es la hora de CAPTURA del punto: con la cola offline, un
  /// punto puede enviarse mucho después de capturarse y debe registrarse con
  /// su hora real (migración 008).
  ///
  /// Still throws on genuine transport/DB errors; those are not swallowed.
  Future<String> insertVehiclePosition({
    required String token,
    required double latitude,
    required double longitude,
    required double speedKmh,
    required double heading,
    DateTime? capturedAt,
  }) async {
    final result = await _client.rpc('insert_vehicle_position', params: {
      'token': token,
      'lat': latitude,
      'lon': longitude,
      'speed': speedKmh,
      'heading': heading,
      if (capturedAt != null)
        'captured_at': capturedAt.toUtc().toIso8601String(),
    });
    return (result as String?) ?? 'ok';
  }
}
