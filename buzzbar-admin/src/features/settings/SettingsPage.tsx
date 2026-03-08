import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { type Resolver, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';
import { Textarea } from '../../components/ui/textarea.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';
import { useCapabilities } from '../../lib/permissions/useCapabilities.js';
import { adminGetSettings, adminUpdateSettings, type SettingsPatch } from './settings.api.js';
import type { AdminSettings } from './settings.types.js';

const SettingsSchema = z.object({
  nightStart: z.string().regex(/^\d{2}:\d{2}$/),
  nightEnd: z.string().regex(/^\d{2}:\d{2}$/),
  serviceAreasText: z.string(),
  deliveryFeeFlat: z.coerce.number().int().min(0),
  legalAgeMin: z.coerce.number().int().min(1).max(120)
});
type SettingsForm = z.infer<typeof SettingsSchema>;

export function SettingsPage() {
  const { can } = useCapabilities();
  const canWrite = can('settings_write');

  const qc = useQueryClient();
  const queryKey = useMemo(() => ['admin', 'settings'], []);
  const q = useQuery({ queryKey, queryFn: () => adminGetSettings() });

  const settings = q.data;

  const form = useForm<SettingsForm>({
    resolver: zodResolver(SettingsSchema) as unknown as Resolver<SettingsForm>,
    defaultValues: {
      nightStart: '22:00',
      nightEnd: '06:00',
      serviceAreasText: '',
      deliveryFeeFlat: 0,
      legalAgeMin: 18
    }
  });

  const [editMode, setEditMode] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!settings) return;
    form.reset(
      {
        nightStart: settings.nightHours.start,
        nightEnd: settings.nightHours.end,
        serviceAreasText: (settings.serviceAreas ?? []).join('\n'),
        deliveryFeeFlat: settings.deliveryFeeFlat,
        legalAgeMin: settings.legalAgeMin
      },
      { keepDirty: false }
    );
  }, [settings, form]);

  const update = useMutation({
    mutationFn: async (patch: SettingsPatch) => adminUpdateSettings(patch),
    onSuccess: async () => {
      toast.success('Settings updated');
      setEditMode(false);
      setConfirmOpen(false);
      await qc.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      const e = normalizeApiError(err);
      toast.error(e.errorCode ? `${e.errorCode}: ${e.message}` : e.message);
    }
  });

  function diffSummary(original: AdminSettings, current: SettingsForm) {
    const nextAreas = current.serviceAreasText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const diffs: Array<{ label: string; before: string; after: string }> = [];

    if (original.nightHours.start !== current.nightStart) diffs.push({ label: 'Night hours start', before: original.nightHours.start, after: current.nightStart });
    if (original.nightHours.end !== current.nightEnd) diffs.push({ label: 'Night hours end', before: original.nightHours.end, after: current.nightEnd });
    if (original.serviceAreas.join(',') !== nextAreas.join(',')) diffs.push({ label: 'Service areas', before: original.serviceAreas.join(', '), after: nextAreas.join(', ') });
    if (original.deliveryFeeFlat !== current.deliveryFeeFlat) diffs.push({ label: 'Delivery fee flat', before: String(original.deliveryFeeFlat), after: String(current.deliveryFeeFlat) });
    if (original.legalAgeMin !== current.legalAgeMin) diffs.push({ label: 'Legal age min', before: String(original.legalAgeMin), after: String(current.legalAgeMin) });

    return { diffs, nextAreas };
  }

  function buildPatch(original: AdminSettings, current: SettingsForm) {
    const { diffs, nextAreas } = diffSummary(original, current);
    const patch: SettingsPatch = {};
    for (const d of diffs) {
      if (d.label === 'Night hours start' || d.label === 'Night hours end') {
        patch.nightHours = {
          start: current.nightStart,
          end: current.nightEnd,
          timezone: original.nightHours.timezone
        };
      }
      if (d.label === 'Service areas') patch.serviceAreas = nextAreas;
      if (d.label === 'Delivery fee flat') patch.deliveryFeeFlat = current.deliveryFeeFlat;
      if (d.label === 'Legal age min') patch.legalAgeMin = current.legalAgeMin;
    }
    return { patch, diffs };
  }

  return (
    <div className="space-y-4">
      {q.isError ? <ErrorState error={normalizeApiError(q.error)} onRetry={() => q.refetch()} /> : null}

      {q.isLoading ? (
        <Card className="p-6">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </Card>
      ) : null}

      {settings ? (
        <>
          <Card className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Business settings</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Timezone: <span className="font-mono">{settings.nightHours.timezone}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Updated: {new Date(settings.updatedAt).toLocaleString()}
                </div>
              </div>
              {canWrite ? (
                <div className="flex items-center gap-2">
                  {!editMode ? (
                    <Button onClick={() => setEditMode(true)}>Edit</Button>
                  ) : (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (settings) {
                            form.reset(
                              {
                                nightStart: settings.nightHours.start,
                                nightEnd: settings.nightHours.end,
                                serviceAreasText: (settings.serviceAreas ?? []).join('\n'),
                                deliveryFeeFlat: settings.deliveryFeeFlat,
                                legalAgeMin: settings.legalAgeMin
                              },
                              { keepDirty: false }
                            );
                          } else {
                            form.reset(undefined, { keepDirty: false });
                          }
                          setEditMode(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={() => setConfirmOpen(true)} disabled={!form.formState.isDirty}>
                        Review changes
                      </Button>
                    </>
                  )}
                </div>
              ) : (
                <Badge>Read-only</Badge>
              )}
            </div>
          </Card>

          {!canWrite ? (
            <Card className="p-4">
              <div className="text-sm text-muted-foreground">Only SuperAdmin can edit settings.</div>
            </Card>
          ) : null}

          <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
            <Card className="p-4">
              <div className="text-sm font-semibold">Night hours (COD restriction window)</div>
              <div className="mt-1 text-xs text-muted-foreground">Timezone is always shown explicitly: Asia/Kathmandu.</div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Start (HH:mm)</Label>
                  <Input disabled={!editMode} {...form.register('nightStart')} />
                </div>
                <div className="grid gap-2">
                  <Label>End (HH:mm)</Label>
                  <Input disabled={!editMode} {...form.register('nightEnd')} />
                </div>
                <div className="grid gap-2">
                  <Label>Timezone</Label>
                  <Input disabled value={settings.nightHours.timezone} />
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">Service areas</div>
              <div className="mt-1 text-xs text-muted-foreground">One area per line.</div>
              <div className="mt-4 grid gap-2">
                <Textarea disabled={!editMode} rows={4} {...form.register('serviceAreasText')} />
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">Delivery fee</div>
              <div className="mt-4 grid gap-2 md:w-[280px]">
                <Label>Flat fee (integer NPR)</Label>
                <Input disabled={!editMode} type="number" min={0} step={1} {...form.register('deliveryFeeFlat')} />
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">Legal age</div>
              <div className="mt-4 grid gap-2 md:w-[280px]">
                <Label>Minimum age</Label>
                <Input disabled={!editMode} type="number" min={1} max={120} step={1} {...form.register('legalAgeMin')} />
              </div>
            </Card>
          </form>

          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm settings update?</DialogTitle>
                <DialogDescription>No silent saves. Review the changes carefully.</DialogDescription>
              </DialogHeader>
              <div className="mt-4 space-y-2 text-sm">
                {(() => {
                  const current = form.getValues();
                  const { diffs } = buildPatch(settings, current);
                  if (diffs.length === 0) return <div className="text-sm text-muted-foreground">No changes.</div>;
                  return diffs.map((d) => (
                    <div key={d.label} className="rounded-md border p-3">
                      <div className="text-xs font-semibold">{d.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {d.before} → <span className="text-foreground">{d.after}</span>
                      </div>
                    </div>
                  ));
                })()}
              </div>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                  Back
                </Button>
                <Button
                  disabled={update.isPending}
                  onClick={async () => {
                    const current = form.getValues();
                    const { patch, diffs } = buildPatch(settings, current);
                    if (diffs.length === 0) {
                      setConfirmOpen(false);
                      return;
                    }
                    const parsed = SettingsSchema.safeParse(current);
                    if (!parsed.success) {
                      toast.error('Fix validation errors before saving');
                      return;
                    }
                    await update.mutateAsync(patch);
                  }}
                >
                  Confirm update
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
