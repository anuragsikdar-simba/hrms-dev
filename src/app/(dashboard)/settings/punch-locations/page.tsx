"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import api from "@/lib/api-client";
import type { GeoZoneDto } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MapPin, Plus, Trash2, Crosshair, Loader2 } from "lucide-react";
import { Skeleton, SkeletonCard, SkeletonPageHeader } from "@/components/ui/skeleton";

/* ------------------------------------------------------------------ */
/*  Punch Locations (geofencing) settings                              */
/*                                                                     */
/*  Zones are circles (lat/lng + radius). When enabled, punch-ins from */
/*  outside every zone are allowed but flagged for admin review in the */
/*  Approvals queue (Location type) - mirroring the IP allowlist.      */
/* ------------------------------------------------------------------ */

export default function PunchLocationsPage() {
  const { isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [enabled, setEnabled] = React.useState(false);
  const [zones, setZones] = React.useState<GeoZoneDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // Add-zone dialog state
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [form, setForm] = React.useState({ label: "", lat: "", lng: "", radiusM: "250" });
  const [formError, setFormError] = React.useState("");
  const [locating, setLocating] = React.useState(false);

  // Admin-only guard
  React.useEffect(() => {
    if (!authLoading && !isAdmin) router.replace("/dashboard");
  }, [authLoading, isAdmin, router]);

  React.useEffect(() => {
    (async () => {
      try {
        const { config } = await api.geoZones.get();
        setEnabled(config.enabled);
        setZones(config.zones);
      } catch (err) {
        toast({ variant: "error", title: "Failed to load punch locations", description: String(err) });
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (nextEnabled: boolean, nextZones: GeoZoneDto[]) => {
    setSaving(true);
    try {
      const { config } = await api.geoZones.save({ enabled: nextEnabled, zones: nextZones });
      setEnabled(config.enabled);
      setZones(config.zones);
      toast({
        variant: "success",
        title: "Punch locations saved",
        description: config.enabled
          ? `Geofencing ON with ${config.zones.length} location(s).`
          : "Geofencing is off.",
      });
      return true;
    } catch (err) {
      toast({ variant: "error", title: "Failed to save", description: String(err) });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async () => {
    if (!enabled && zones.length === 0) {
      toast({
        variant: "error",
        title: "Add a location first",
        description: "Geofencing needs at least one approved location.",
      });
      return;
    }
    await persist(!enabled, zones);
  };

  const handleAddZone = async () => {
    const lat = parseFloat(form.lat);
    const lng = parseFloat(form.lng);
    const radiusM = parseInt(form.radiusM, 10);
    if (!form.label.trim()) { setFormError("Please give this location a name."); return; }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { setFormError("Latitude must be between -90 and 90."); return; }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) { setFormError("Longitude must be between -180 and 180."); return; }
    if (!Number.isFinite(radiusM) || radiusM < 20 || radiusM > 50000) { setFormError("Radius must be 20m - 50,000m."); return; }
    setFormError("");

    const zone: GeoZoneDto = {
      id: `zone_${Date.now()}`,
      label: form.label.trim(),
      lat,
      lng,
      radiusM,
    };
    const ok = await persist(enabled, [...zones, zone]);
    if (ok) {
      setDialogOpen(false);
      setForm({ label: "", lat: "", lng: "", radiusM: "250" });
    }
  };

  const handleRemoveZone = async (id: string) => {
    const next = zones.filter((z) => z.id !== id);
    // Disable automatically if the last zone is removed.
    await persist(next.length === 0 ? false : enabled, next);
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setFormError("This browser does not support geolocation.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          lat: pos.coords.latitude.toFixed(6),
          lng: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      () => {
        setFormError("Could not get your location. Enter coordinates manually.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  if (authLoading || loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <SkeletonPageHeader />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
        <div className="space-y-4">
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Punch Locations</h1>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Define where employees are allowed to punch in. Punches outside these
            locations are allowed but flagged for review in Approvals.
          </p>
        </div>
        <Button onClick={() => { setFormError(""); setDialogOpen(true); }}>
          <Plus className="h-4 w-4" />
          Add Location
        </Button>
      </div>

      {/* Enforcement toggle */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <p className="text-sm font-medium text-gray-900">Geofencing enforcement</p>
            <p className="text-[12px] text-gray-500 mt-0.5">
              {enabled
                ? "ON - punch-ins are checked against the locations below."
                : "OFF - location is not checked at punch-in."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={enabled ? "green" : "slate"}>{enabled ? "Enabled" : "Disabled"}</Badge>
            <Button variant="outline" size="sm" onClick={handleToggle} disabled={saving}>
              {enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Zones list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Approved locations</CardTitle>
          <CardDescription>
            Circular zones - an employee within the radius of any zone punches in normally.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {zones.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <MapPin className="h-8 w-8 text-gray-300 mb-2" />
              <p className="text-[13px] text-gray-400">No locations yet. Add your office to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {zones.map((z) => (
                <div key={z.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <MapPin className="h-4 w-4 shrink-0 text-teal-600" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{z.label}</p>
                      <p className="font-mono text-[11px] text-gray-500">
                        {z.lat.toFixed(5)}, {z.lng.toFixed(5)} &middot; radius{" "}
                        {z.radiusM >= 1000 ? `${(z.radiusM / 1000).toFixed(1)}km` : `${z.radiusM}m`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={`https://www.google.com/maps?q=${z.lat},${z.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-medium text-blue-600 hover:underline"
                    >
                      View map
                    </a>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handleRemoveZone(z.id)}
                      disabled={saving}
                      aria-label={`Remove ${z.label}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-gray-400 hover:text-red-600" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-[11px] text-gray-400">
        Note: location comes from the employee&apos;s browser GPS, so it can be inaccurate indoors
        and is not tamper-proof. Use it together with the IP allowlist for stronger control.
      </p>

      {/* Add location dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) setDialogOpen(false); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add punch location</DialogTitle>
            <DialogDescription>
              Enter the coordinates of the location and how far around it (radius) counts as
              &quot;at this location&quot;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              label="Name *"
              placeholder="e.g. Head Office"
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Latitude *"
                placeholder="18.5204"
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
              />
              <Input
                label="Longitude *"
                placeholder="73.8567"
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
              />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleUseMyLocation} disabled={locating}>
              {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
              {locating ? "Locating..." : "Use my current location"}
            </Button>
            <Input
              label="Radius (meters) *"
              type="number"
              min={20}
              max={50000}
              value={form.radiusM}
              onChange={(e) => setForm((f) => ({ ...f, radiusM: e.target.value }))}
              helperText="250m suits most offices. GPS accuracy tolerance is added automatically."
            />
            {formError && <p className="text-[12px] text-red-600">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleAddZone} disabled={saving}>
              {saving ? "Saving..." : "Add Location"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
