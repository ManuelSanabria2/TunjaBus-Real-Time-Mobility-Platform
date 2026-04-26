import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseService {
  final SupabaseClient _client = Supabase.instance.client;

  /// Retrieves the vehicle UUID based on the provided secret driver token.
  /// Returns null if the token does not match any vehicle.
  Future<String?> getVehicleIdByToken(String token) async {
    try {
      final response = await _client
          .from('vehicles')
          .select('id')
          .eq('token', token)
          .maybeSingle();

      if (response != null && response['id'] != null) {
        return response['id'] as String;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  /// Inserts the exact vehicle position into Supabase.
  Future<bool> insertPosition({
    required String vehicleId,
    required String token,
    required double latitude,
    required double longitude,
    required double speedKmh,
    required double heading,
  }) async {
    try {
      await _client.from('vehicle_positions').insert({
        'vehicle_id': vehicleId,
        'latitude': latitude,
        'longitude': longitude,
        'speed_kmh': speedKmh,
        'heading': heading,
      });

      return true;
    } on PostgrestException catch (_) {
      return false;
    } catch (_) {
      return false;
    }
  }
}
