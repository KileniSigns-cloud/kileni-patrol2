import { useState } from 'react';

export function useCamera() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const capture = async (file: File) => {
    return new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        setPhotos(prev => [...prev, base64]);
        resolve(base64);
      };
      reader.readAsDataURL(file);
    });
  };

  const clear = () => setPhotos([]);

  return { photos, uploading, capture, clear };
}
