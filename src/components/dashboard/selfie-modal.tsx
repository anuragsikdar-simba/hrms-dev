'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Camera, RefreshCw, Check, AlertCircle, Building2, Home, Briefcase, MapPin } from 'lucide-react';

export type WorkMode = 'office' | 'home' | 'client' | 'onsite';

const WORK_MODES: { id: WorkMode; label: string; icon: React.ElementType }[] = [
  { id: 'office', label: 'Office', icon: Building2 },
  { id: 'home', label: 'Home', icon: Home },
  { id: 'client', label: 'Client', icon: Briefcase },
  { id: 'onsite', label: 'On-site', icon: MapPin },
];

interface SelfieModalProps {
  open: boolean;
  onClose: () => void;
  actionType: 'punch_in' | 'punch_out';
  initialWorkMode?: WorkMode;
  onCapture: (selfieDataUrl: string | null, workMode: WorkMode) => void;
  loading?: boolean;
}

/**
 * Center-crops and compresses an image File or Blob into 360x360 WebP @ 0.65 (~12 KB).
 * Works across all browsers and devices without external dependencies.
 */
async function processAndCompressImage(source: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const size = 360;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return reject(new Error('Canvas context unavailable'));
        }

        // 1:1 square center-crop
        const minDim = Math.min(img.width, img.height);
        const startX = (img.width - minDim) / 2;
        const startY = (img.height - minDim) / 2;

        ctx.drawImage(img, startX, startY, minDim, minDim, 0, 0, size, size);

        let dataUrl = canvas.toDataURL('image/webp', 0.65);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        }
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('Failed to parse image'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(source);
  });
}

export function SelfieModal({
  open,
  onClose,
  actionType,
  initialWorkMode = 'office',
  onCapture,
  loading = false,
}: SelfieModalProps) {
  const [workMode, setWorkMode] = useState<WorkMode>(initialWorkMode);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<string | null>(null);
  const [useFallbackCamera, setUseFallbackCamera] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Stop live media stream
  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, []);

  // Try live stream if available and secure (localhost / HTTPS)
  const startLiveCamera = useCallback(async () => {
    const isSecure = typeof window !== 'undefined' && (window.isSecureContext || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const hasMediaDevices = typeof navigator !== 'undefined' && !!navigator?.mediaDevices?.getUserMedia;

    if (!isSecure || !hasMediaDevices) {
      // Over plain HTTP LAN (e.g. http://10.0.1.250:3000 on mobile),
      // mobile Chrome requires HTML Media Capture (<input type="file" capture="user">)
      setUseFallbackCamera(true);
      return;
    }

    setInitializing(true);
    stopStream();

    try {
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
      setUseFallbackCamera(false);
    } catch {
      // If live stream is blocked or fails, seamlessly fall back to HTML media capture
      setUseFallbackCamera(true);
    } finally {
      setInitializing(false);
    }
  }, [stopStream]);

  useEffect(() => {
    if (open) {
      setPhoto(null);
      startLiveCamera();
    } else {
      stopStream();
      setPhoto(null);
    }
    return () => {
      stopStream();
    };
  }, [open, startLiveCamera, stopStream]);

  // Snap from live stream
  const snapLivePhoto = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;

    const size = 360;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const minDim = Math.min(video.videoWidth, video.videoHeight);
    const startX = (video.videoWidth - minDim) / 2;
    const startY = (video.videoHeight - minDim) / 2;

    // Mirror horizontally for selfie
    ctx.translate(size, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, startX, startY, minDim, minDim, 0, 0, size, size);

    let dataUrl = canvas.toDataURL('image/webp', 0.65);
    if (!dataUrl.startsWith('data:image/webp')) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    }

    setPhoto(dataUrl);
    stopStream();
  };

  // Handle native mobile camera capture (HTML5 capture="user")
  const handleNativeFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    try {
      const compressedWebP = await processAndCompressImage(file);
      setPhoto(compressedWebP);
    } catch (err) {
      console.error('[selfie] file compression error:', err);
    } finally {
      setProcessing(false);
      // reset file input value so selecting again works
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const triggerNativeCamera = () => {
    fileInputRef.current?.click();
  };

  const handleRetake = () => {
    setPhoto(null);
    if (useFallbackCamera) {
      triggerNativeCamera();
    } else {
      startLiveCamera();
    }
  };

  const handleConfirm = () => {
    onCapture(photo, workMode);
  };

  const handleSkip = () => {
    stopStream();
    onCapture(null, workMode);
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
        {/* Work Location Mode Selection */}
        <div className="w-full mt-2 mb-2">
          <p className="text-xs font-semibold text-gray-700 mb-2">
            Select work location:
          </p>
          <div className="grid grid-cols-4 gap-1.5">
            {WORK_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setWorkMode(m.id)}
                className={cn(
                  'flex flex-col items-center justify-center py-2 px-1 rounded-lg border text-xs font-medium transition-all cursor-pointer',
                  workMode === m.id
                    ? 'border-gray-900 bg-gray-900 text-white shadow-sm'
                    : 'border-gray-200 bg-gray-50/70 text-gray-700 hover:bg-gray-100 hover:border-gray-300'
                )}
              >
                <m.icon className={cn('h-4 w-4 mb-1', workMode === m.id ? 'text-white' : 'text-gray-500')} />
                <span className="text-[11px] leading-tight text-center">{m.label}</span>
              </button>
            ))}
          </div>
        </div>


        {/* Hidden native camera capture input for mobile devices */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={handleNativeFile}
        />

        <div className="flex flex-col items-center justify-center py-2">
          <div className="relative flex flex-col items-center">
            {/* Circular photo frame */}
            <div className="relative h-64 w-64 overflow-hidden rounded-full border-4 border-gray-900/10 bg-gray-900 shadow-inner flex items-center justify-center">
              {processing ? (
                <div className="flex flex-col items-center gap-2 text-white text-xs">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  <span>Processing selfie...</span>
                </div>
              ) : photo ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={photo}
                  alt="Selfie preview"
                  className="h-full w-full object-cover"
                />
              ) : useFallbackCamera ? (
                <div className="flex flex-col items-center justify-center p-6 text-center text-white">
                  <Camera className="h-12 w-12 text-gray-400 mb-2" />
                  <p className="text-xs text-gray-300">Tap below to take a selfie</p>
                </div>
              ) : (
                <>
                  {initializing && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white text-xs z-10">
                      Opening camera...
                    </div>
                  )}
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="h-full w-full object-cover scale-x-[-1]"
                  />
                </>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-5 flex items-center gap-3">
              {photo ? (
                <>
                  <Button
                    variant="outline"
                    onClick={handleRetake}
                    disabled={loading || processing}
                    className="gap-1.5"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retake
                  </Button>
                  <Button
                    onClick={handleConfirm}
                    disabled={loading || processing}
                    className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Check className="h-4 w-4" />
                    {loading ? 'Processing...' : `Confirm & ${actionLabel}`}
                  </Button>
                </>
              ) : useFallbackCamera ? (
                <>
                  <Button
                    onClick={triggerNativeCamera}
                    disabled={loading || processing}
                    className="gap-2 bg-gray-900 hover:bg-black text-white px-6"
                  >
                    <Camera className="h-4 w-4" />
                    Take Selfie
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSkip}
                    disabled={loading}
                    className="text-xs text-gray-500"
                  >
                    Skip
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    onClick={snapLivePhoto}
                    disabled={initializing}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
