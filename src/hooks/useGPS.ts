import { useState, useEffect } from 'react';

export function useGPS() {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'success' | 'error'>('idle');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported');
      setStatus('error');
      return;
    }

    setStatus('capturing');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude);
        setLng(position.coords.longitude);
        setStatus('success');
        setError(null);
      },
      (err) => {
        setError(err.message);
        setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { status, lat, lng, error };
}
