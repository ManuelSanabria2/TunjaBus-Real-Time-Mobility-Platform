import 'dart:async';
import 'package:geolocator/geolocator.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'kalman_filter.dart';

class GpsService {
  StreamSubscription<Position>? _positionStream;
  Position? _lastSentPosition;
  DateTime? _lastSentTime;

  // Settings
  double _minDistance = 2.0;
  double _maxInterval = 5.0;

  // Filters
  final SimpleKalmanFilter _kalmanLat = SimpleKalmanFilter();
  final SimpleKalmanFilter _kalmanLon = SimpleKalmanFilter();

  // Stream controller to broadcast filtered valid updates to UI & Supabase
  final StreamController<Position> _filteredPositionStream = StreamController<Position>.broadcast();
  Stream<Position> get positionStream => _filteredPositionStream.stream;

  Future<bool> requestPermissions() async {
    bool serviceEnabled;
    LocationPermission permission;

    serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      return false;
    }

    permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        return false;
      }
    }

    if (permission == LocationPermission.deniedForever) {
      return false;
    }

    return true;
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    _minDistance = prefs.getDouble('min_distance') ?? 2.0;
    _maxInterval = prefs.getDouble('max_interval') ?? 5.0;
  }

  void startTracking() async {
    await _loadSettings();
    print("Starting raw GPS tracking with minDist(x\${_minDistance}m) and maxInt(x\${_maxInterval}s)...");

    const LocationSettings locationSettings = LocationSettings(
      accuracy: LocationAccuracy.bestForNavigation,
      distanceFilter: 0, // We receive them all, but filter them manually
    );

    _positionStream = Geolocator.getPositionStream(locationSettings: locationSettings)
        .listen((Position position) {
      _evaluatePosition(position);
    });
  }

  void _evaluatePosition(Position newPosition) {
    // 1. Process coordinates through Kalman Filter to reduce noise
    double fLat = _kalmanLat.filter(newPosition.latitude);
    double fLon = _kalmanLon.filter(newPosition.longitude);

    // Create a mock filtered Position based on new metrics but original velocity/heading
    Position filteredPosition = Position(
      latitude: fLat,
      longitude: fLon,
      timestamp: newPosition.timestamp,
      accuracy: newPosition.accuracy,
      altitude: newPosition.altitude,
      altitudeAccuracy: newPosition.altitudeAccuracy,
      heading: newPosition.heading,
      headingAccuracy: newPosition.headingAccuracy,
      speed: newPosition.speed,
      speedAccuracy: newPosition.speedAccuracy,
    );

    if (_lastSentPosition == null || _lastSentTime == null) {
      // First position always valid
      _emitPosition(filteredPosition);
      return;
    }

    // Rule: Send if moved > minDistance meters (based on cleanly filtered position)
    double distance = Geolocator.distanceBetween(
      _lastSentPosition!.latitude,
      _lastSentPosition!.longitude,
      filteredPosition.latitude,
      filteredPosition.longitude,
    );

    // Rule: Send if time > maxInterval seconds (heartbeat)
    int secondsPassed = DateTime.now().difference(_lastSentTime!).inSeconds;

    if (distance > _minDistance || secondsPassed >= _maxInterval) {
      _emitPosition(filteredPosition);
    }
  }

  void _emitPosition(Position position) {
    _lastSentPosition = position;
    _lastSentTime = DateTime.now();
    _filteredPositionStream.add(position);
  }

  void stopTracking() {
    _positionStream?.cancel();
    _positionStream = null;
    _lastSentPosition = null;
    _lastSentTime = null;
    print("GPS tracking stopped.");
  }

  // To calculate total distance after stopping the shift
  double calculateDistance(List<Position> path) {
    double totalDist = 0.0;
    for (int i = 0; i < path.length - 1; i++) {
      totalDist += Geolocator.distanceBetween(
        path[i].latitude,
        path[i].longitude,
        path[i+1].latitude,
        path[i+1].longitude,
      );
    }
    return totalDist;
  }
}
