import { useState, useEffect, useCallback } from 'react';

export function useGPS() {
  const [status, setStatus] = useState<'idle' | 'capturing' | 'success' | 'error'>('idle');
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const capture = useCallback(() => {
    if (!navigator.geolocation) {
      setErrorMessage('Location not available on this device');
      setStatus('error');
      return;
    }

    setStatus('capturing');
    setErrorMessage('');

    const onSuccess = (pos: GeolocationPosition) => {
      setLatitude(pos.coords.latitude);
      setLongitude(pos.coords.longitude);
      setAccuracy(Math.round(pos.coords.accuracy));
      setStatus('success');
      setErrorMessage('');
    };

    const onError = (error: GeolocationPositionError) => {
      setStatus('error');
      if (error.code === 1) {
        setErrorMessage('Location access denied. Please enable in your browser settings.');
      } else if (error.code === 2) {
        setErrorMessage('Location unavailable. Please try again.');
      } else if (error.code === 3) {
        setErrorMessage('Location request timed out. Please try again.');
      } else {
        setErrorMessage('Unable to get location.');
      }
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: true,
      timeout: 10000,
    });
  }, []);

  useEffect(() => { capture(); }, [capture]);

  return { latitude, longitude, accuracy, status, errorMessage, retry: capture };
}
