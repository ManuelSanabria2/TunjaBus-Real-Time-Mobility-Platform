class SimpleKalmanFilter {
  final double q; // Process noise (variance of the evolution of the system)
  final double r; // Measurement noise (variance of the GPS accuracy)
  
  double _p = 1.0; // Estimation error covariance
  double _x = double.nan; // Estimated value
  double _k = 0.0; // Kalman gain

  SimpleKalmanFilter({this.q = 0.0001, this.r = 0.01});

  double filter(double measurement) {
    if (_x.isNaN) {
      _x = measurement;
      return _x;
    }
    
    // Prediction Update
    _p = _p + q;
    
    // Measurement Update
    _k = _p / (_p + r);
    _x = _x + _k * (measurement - _x);
    _p = (1 - _k) * _p;
    
    return _x;
  }
}
