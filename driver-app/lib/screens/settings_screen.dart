import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({Key? key}) : super(key: key);

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  double _minDistance = 10.0;
  double _maxInterval = 30.0;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _minDistance = prefs.getDouble('min_distance') ?? 10.0;
      _maxInterval = prefs.getDouble('max_interval') ?? 30.0;
      _isLoading = false;
    });
  }

  Future<void> _saveSettings() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setDouble('min_distance', _minDistance);
    await prefs.setDouble('max_interval', _maxInterval);
    
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Configuración guardada satisfactoriamente. Aplica al siguiente turno.')),
      );
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Configuración Avanzada GPS'),
        backgroundColor: Colors.red[800],
      ),
      body: Padding(
        padding: const EdgeInsets.all(20.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Distancia Mínima (Filtro Espacial)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 5),
            Text(
              'Envía el paquete solo si el bus se movió más de ${_minDistance.round()} metros.',
              style: const TextStyle(color: Colors.grey),
            ),
            Slider(
              value: _minDistance,
              min: 5.0,
              max: 50.0,
              divisions: 45,
              label: '${_minDistance.round()}m',
              onChanged: (val) {
                setState(() => _minDistance = val);
              },
            ),
            const Divider(height: 40),
            Text(
              'Intervalo de Latido (Filtro Temporal)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 5),
            Text(
              'Envía ubicación forzada cada ${_maxInterval.round()} segundos si el bus está en un trancón / quieto.',
              style: const TextStyle(color: Colors.grey),
            ),
            Slider(
              value: _maxInterval,
              min: 10.0,
              max: 60.0,
              divisions: 50,
              label: '${_maxInterval.round()}s',
              onChanged: (val) {
                setState(() => _maxInterval = val);
              },
            ),
            const Spacer(),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: ElevatedButton(
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green[700]),
                onPressed: _saveSettings,
                child: const Text('GUARDAR AJUSTES', style: TextStyle(fontSize: 18)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
