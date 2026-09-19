'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, RefreshCw, Check, AlertCircle } from 'lucide-react';

interface SelfieModalProps {
  open: boolean;
  onClose: () => void;
  actionType: 'punch_in' | 'punch_out';
  onCapture: (selfieDataUrl: string | null) => void;
  loading?: boolean;
}

export function SelfieModal({
  open,
  onClose,
  actionType,
  onCapture,
  loading = false,
}: SelfieModalProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  // Stop camera stream cleanly
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Start front camera
  const startCamera = useCallback(async () => {
    setInitializing(true);
    setCameraError(null);
    setPhoto(null);
    stopStream();

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Camera access not supported on this device/browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not access camera.';
      setCameraError(msg);
    } finally {
      setInitializing(false);
    }
  }, [stopStream]);

  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopStream();
      setPhoto(null);
    }
    return () => {
      stopStream();
    };
  }, [open, startCamera, stopStream]);

  // Snap and compress to 360x360 WebP @ 0.65 (~12 KB)
  const snapPhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const size = 360;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Center crop to 1:1 square
    const minDim = Math.min(video.videoWidth, video.videoHeight);
    const startX = (video.videoWidth - minDim) / 2;
    const startY = (video.videoHeight - minDim) / 2;

    // Mirror horizontally for intuitive selfie look
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, startX, startY, minDim, minDim, 0, 0, size, size);

    // Export as WebP (falls back to jpeg if webp unsupported)
    let dataUrl = canvas.toDataURL('image/webp', 0.65);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    }

    setPhoto(dataUrl);
    stopStream();
  };

  const handleRetake = () => {
    setPhoto(null);
    startCamera();
  };

  const handleConfirm = () => {
    onCapture(photo);
  };

  const handleSkip = () => {
    stopStream();
    onCapture(null);
  };

  const actionLabel = actionType === 'punch_in' ? 'Punch In' : 'Punch Out';

  return (
    <Dialog open={open} onOpenChange={(v) => !loading && !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Camera className="h-5 w-5 text-gray-700" />
            Photo Verification
          </DialogTitle>
          <DialogDescription>
            Smile for a quick selfie to verify your {actionLabel.toLowerCase()}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center justify-center py-2">
          {cameraError ? (
            <div className="w-full rounded-xl border border-amber-200 bg-amber-50/80 p-5 text-center">
              <AlertCircle className="mx-auto mb-2 h-8 w-8 text-amber-600" />
              <p className="text-sm font-medium text-amber-900">Camera Unavailable</p>
              <p className="mt-1 text-xs text-amber-700">{cameraError}</p>
              <p className="mt-3 text-xs text-gray-500">
                You can still proceed with your standard {actionLabel.toLowerCase()}.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={handleSkip}
                disabled={loading}
              >
                Continue without photo
              </Button>
            </div>
          ) : (
            <div className="relative flex flex-col items-center">
              {/* Photo viewport */}
              <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-gray-900/10 bg-gray-900 shadow-inner">
                {initializing && (
                  <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white text-xs">
                    Opening camera...
                  </div>
                )}

                {photo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={photo}
                    alt="Selfie preview"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover scale-x-[-1]"
                  />
                )}
              </div>

              {/* Action buttons below camera */}
              <div className="mt-5 flex items-center gap-3">
                {photo ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleRetake}
                      disabled={loading}
                      className="gap-1.5"
                    >
                      <RefreshCw className="h-4 w-4" />
                      Retake
                    </Button>
                    <Button
                      onClick={handleConfirm}
                      disabled={loading}
                      className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                    >
                      <Check className="h-4 w-4" />
                      {loading ? 'Processing...' : `Confirm & ${actionLabel}`}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      onClick={snapPhoto}
                      disabled={initializing || !!cameraError}
                      className="gap-2 bg-gray-900 hover:bg-black text-white px-6"
                    >
                      <Camera className="h-4 w-4" />
                      Take Photo
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleSkip}
                      className="text-xs text-gray-500"
                    >
                      Skip
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
