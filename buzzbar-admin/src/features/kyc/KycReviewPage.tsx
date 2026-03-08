import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog.js';
import { Textarea } from '../../components/ui/textarea.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';
import { adminApproveKyc, adminGetUserKyc, adminRejectKyc } from './kyc.api.js';

function fmtDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function reasonChips(reason?: string) {
  const raw = (reason ?? '').trim();
  if (!raw) return [];
  return raw.split('|').map((s) => s.trim()).filter(Boolean);
}

export function KycReviewPage() {
  const params = useParams();
  const userId = String(params.userId ?? '');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const queryKey = useMemo(() => ['admin', 'kyc', 'user', userId], [userId]);
  const q = useQuery({ queryKey, queryFn: () => adminGetUserKyc(userId), enabled: Boolean(userId) });

  const approve = useMutation({
    mutationFn: () => adminApproveKyc(userId),
    onSuccess: async () => {
      toast.success('KYC approved');
      await qc.invalidateQueries({ queryKey: ['admin', 'kyc', 'queue'] });
      await qc.invalidateQueries({ queryKey });
      navigate('/kyc?status=pending', { replace: true });
    },
    onError: (err) => {
      const e = normalizeApiError(err);
      toast.error(e.errorCode ? `${e.errorCode}: ${e.message}` : e.message);
    }
  });

  const reject = useMutation({
    mutationFn: (reason: string) => adminRejectKyc(userId, reason),
    onSuccess: async () => {
      toast.success('KYC rejected');
      await qc.invalidateQueries({ queryKey: ['admin', 'kyc', 'queue'] });
      await qc.invalidateQueries({ queryKey });
      navigate('/kyc?status=pending', { replace: true });
    },
    onError: (err) => {
      const e = normalizeApiError(err);
      toast.error(e.errorCode ? `${e.errorCode}: ${e.message}` : e.message);
    }
  });

  const data = q.data;
  const user = data?.user;
  const attempt = data?.attempt;
  const history = data?.attemptHistory ?? [];

  const [imgOpen, setImgOpen] = useState(false);
  const [imgTitle, setImgTitle] = useState('');
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const pending = attempt?.status === 'pending';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" asChild>
            <Link to="/kyc">Back</Link>
          </Button>
          <div className="text-sm font-semibold">KYC review</div>
          {attempt ? <Badge variant={attempt.status === 'verified' ? 'success' : attempt.status === 'rejected' ? 'destructive' : 'warning'}>{attempt.status}</Badge> : null}
        </div>
        <div className="text-xs text-muted-foreground">
          Latest KYC attempt for this user (based on <span className="font-mono">user.kycLastAttemptId</span>)
        </div>
      </div>

      {q.isError ? <ErrorState error={normalizeApiError(q.error)} onRetry={() => q.refetch()} /> : null}

      {q.isLoading ? (
        <Card className="p-6">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </Card>
      ) : null}

      {user ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            <Card className="p-4">
              <div className="text-sm font-semibold">Submission summary</div>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">User</div>
                  <div>{user.name ?? user.email ?? user.phone ?? user._id}</div>
                </div>
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">User KYC status</div>
                  <div>{user.kycStatus}</div>
                </div>
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">Attempt ID</div>
                  <div className="font-mono text-xs">{attempt?._id ?? '—'}</div>
                </div>
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">Submitted</div>
                  <div>{fmtDate(attempt?.submittedAt)}</div>
                </div>
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">Auto decision</div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {attempt ? <Badge variant={attempt.autoDecision === 'auto_verified' ? 'success' : 'warning'}>{attempt.autoDecision}</Badge> : null}
                    {reasonChips(attempt?.autoDecisionReason).slice(0, 3).map((c) => (
                      <span key={c} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Images (signed URLs)</div>
                <Button variant="secondary" size="sm" onClick={() => q.refetch()}>
                  Refresh
                </Button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Front</div>
                  <Button
                    className="mt-2 w-full"
                    variant="secondary"
                    disabled={!attempt?.idFront?.url}
                    onClick={() => {
                      setImgTitle('Front');
                      setImgUrl(attempt?.idFront?.url ?? null);
                      setImgOpen(true);
                    }}
                  >
                    View
                  </Button>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Back</div>
                  <Button
                    className="mt-2 w-full"
                    variant="secondary"
                    disabled={!attempt?.idBack?.url}
                    onClick={() => {
                      setImgTitle('Back');
                      setImgUrl(attempt?.idBack?.url ?? null);
                      setImgOpen(true);
                    }}
                  >
                    View
                  </Button>
                </div>
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Selfie</div>
                  <Button
                    className="mt-2 w-full"
                    variant="secondary"
                    disabled={!attempt?.selfie?.url}
                    onClick={() => {
                      setImgTitle('Selfie');
                      setImgUrl(attempt?.selfie?.url ?? null);
                      setImgOpen(true);
                    }}
                  >
                    View
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">OCR comparison</div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Client OCR</div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    <div>DOB raw: {attempt?.clientDobRaw ?? '—'}</div>
                    <div>Confidence: {(attempt?.clientConfidence ?? 0).toFixed(2)}</div>
                  </div>
                  <pre className="mt-3 max-h-64 overflow-auto rounded bg-background p-3 text-xs text-foreground">
                    {attempt?.clientOcrText ?? '—'}
                  </pre>
                </div>

                <div className="rounded-lg border p-3">
                  <div className="text-xs text-muted-foreground">Server OCR</div>
                  <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                    <div>DOB raw: {attempt?.serverDobRaw ?? '—'}</div>
                    <div>Confidence: {(attempt?.serverConfidence ?? 0).toFixed(2)}</div>
                  </div>
                  <pre className="mt-3 max-h-64 overflow-auto rounded bg-background p-3 text-xs text-foreground">
                    {attempt?.serverOcrText ?? '—'}
                  </pre>
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">Parsing outcome</div>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">DOB difference days</div>
                  <div>{attempt?.dobDifferenceDays ?? '—'}</div>
                </div>
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">Parse confidence</div>
                  <div>{typeof attempt?.parseConfidence === 'number' ? attempt.parseConfidence.toFixed(2) : '—'}</div>
                </div>
                <div className="flex justify-between gap-3">
                  <div className="text-muted-foreground">Age</div>
                  <div>
                    {typeof attempt?.ageYears === 'number' ? attempt.ageYears : '—'} / {attempt?.legalAgeMin ?? '—'}
                  </div>
                </div>
                {attempt?.parseErrors?.length ? (
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Parse errors</div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                      {attempt.parseErrors.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="p-4">
              <div className="text-sm font-semibold">Actions</div>
              <div className="mt-3 grid gap-2">
                {!attempt ? <div className="text-sm text-muted-foreground">No attempt found for this user.</div> : null}

                {attempt && !pending ? (
                  <div className="rounded-md border p-3 text-sm text-muted-foreground">
                    This attempt is already reviewed.
                  </div>
                ) : null}

                <Button disabled={!pending || approve.isPending} onClick={() => approve.mutate()}>
                  Approve KYC
                </Button>
                <Button variant="destructive" disabled={!pending} onClick={() => setRejectOpen(true)}>
                  Reject KYC
                </Button>

                <div className="text-xs text-muted-foreground">
                  Rejecting will mark the user as rejected and cancel their <span className="font-mono">KYC_PENDING_REVIEW</span> orders.
                </div>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-semibold">Attempt history</div>
              <div className="mt-3 grid gap-2 text-sm">
                {history.length === 0 ? <div className="text-sm text-muted-foreground">No prior attempts.</div> : null}
                {history.map((h) => (
                  <div key={h._id} className="rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-mono text-xs">{h._id}</div>
                      <Badge>{h.status}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground">
                      Submitted: {fmtDate(h.submittedAt)}{h.reviewedAt ? ` · Reviewed: ${fmtDate(h.reviewedAt)}` : ''}
                    </div>
                    {h.reviewReason ? <div className="mt-1 text-xs text-muted-foreground">Reason: {h.reviewReason}</div> : null}
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      ) : null}

      <Dialog open={imgOpen} onOpenChange={setImgOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{imgTitle}</DialogTitle>
            <DialogDescription>Signed URLs may expire; use refresh if the image fails to load.</DialogDescription>
          </DialogHeader>
          {imgUrl ? (
            <div className="mt-4 overflow-hidden rounded-lg border">
              <img src={imgUrl} alt={imgTitle} className="max-h-[70vh] w-full object-contain" />
            </div>
          ) : (
            <div className="mt-4 text-sm text-muted-foreground">No image available.</div>
          )}
          <DialogFooter>
            {imgUrl ? (
              <Button variant="secondary" asChild>
                <a href={imgUrl} target="_blank" rel="noreferrer">
                  Open in new tab
                </a>
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => setImgOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject KYC?</DialogTitle>
            <DialogDescription>Rejection requires a reason and will cancel the user’s KYC-blocked orders.</DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid gap-2">
            <div className="text-xs text-muted-foreground">Reason</div>
            <Textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder="Describe why the submission is rejected…" />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={reject.isPending || !rejectReason.trim()}
              onClick={async () => {
                await reject.mutateAsync(rejectReason.trim());
                setRejectOpen(false);
                setRejectReason('');
              }}
            >
              Reject KYC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
