import { useQuery } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorState } from '../../components/feedback/ErrorState.js';
import { SavedFiltersBar } from '../../components/feedback/SavedFiltersBar.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { normalizeApiError } from '../../lib/api/normalizeError.js';
import { adminListKycQueue } from './kyc.api.js';
import type { KycAttemptQueueItem } from './kyc.types.js';

export function KycPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const statusParam = (searchParams.get('status') ?? '').trim();
  const status: 'pending' | 'verified' | 'rejected' =
    statusParam === 'verified' ? 'verified' : statusParam === 'rejected' ? 'rejected' : 'pending';

  const sortParam = (searchParams.get('sort') ?? '').trim();
  const sort: 'newest' | 'oldest' = sortParam === 'oldest' ? 'oldest' : 'newest';

  const autoDecisionParam = (searchParams.get('autoDecision') ?? '').trim();
  const autoDecision: 'auto_verified' | 'needs_review' | undefined =
    autoDecisionParam === 'auto_verified' ? 'auto_verified' : autoDecisionParam === 'needs_review' ? 'needs_review' : undefined;
  const reasonToken = (searchParams.get('reasonToken') ?? '').trim() || undefined;
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const limitRaw = Number(searchParams.get('limit') ?? '20') || 20;
  const limit = [20, 50, 100].includes(limitRaw) ? limitRaw : 20;

  const minClientConfidenceStr = (searchParams.get('minClientConfidence') ?? '').trim();
  const minServerConfidenceStr = (searchParams.get('minServerConfidence') ?? '').trim();
  const minClientConfidence = minClientConfidenceStr ? Math.max(0, Math.min(1, Number(minClientConfidenceStr))) : undefined;
  const minServerConfidence = minServerConfidenceStr ? Math.max(0, Math.min(1, Number(minServerConfidenceStr))) : undefined;

  const submittedFrom = (searchParams.get('submittedFrom') ?? '').trim() || undefined; // YYYY-MM-DD
  const submittedTo = (searchParams.get('submittedTo') ?? '').trim() || undefined; // YYYY-MM-DD
  const tz = (searchParams.get('tz') ?? '').trim() || 'Asia/Kathmandu';

  const submittedFromIso = submittedFrom
    ? DateTime.fromISO(submittedFrom, { zone: tz }).startOf('day').toUTC().toISO() ?? undefined
    : undefined;
  const submittedToIso = submittedTo
    ? DateTime.fromISO(submittedTo, { zone: tz }).plus({ days: 1 }).startOf('day').toUTC().toISO() ?? undefined
    : undefined;

  const queryKey = useMemo(
    () => [
      'admin',
      'kyc',
      'queue',
      { status, sort, autoDecision, reasonToken, minClientConfidence, minServerConfidence, submittedFromIso, submittedToIso, page, limit }
    ],
    [status, sort, autoDecision, reasonToken, minClientConfidence, minServerConfidence, submittedFromIso, submittedToIso, page, limit]
  );

  const queueQuery = useQuery({
    queryKey,
    queryFn: () =>
      adminListKycQueue({
        status,
        sort,
        autoDecision,
        reasonToken,
        minClientConfidence,
        minServerConfidence,
        submittedFrom: submittedFromIso,
        submittedTo: submittedToIso,
        page,
        limit
      })
  });

  function setParams(next: Record<string, string | undefined>, opts?: { resetPage?: boolean }) {
    const sp = new URLSearchParams(searchParams);
    if (opts?.resetPage) sp.set('page', '1');
    for (const [k, v] of Object.entries(next)) {
      if (!v) sp.delete(k);
      else sp.set(k, v);
    }
    setSearchParams(sp, { replace: true });
  }

  function setStatus(next: string) {
    const sp = new URLSearchParams();
    sp.set('status', next);
    sp.set('sort', 'newest');
    sp.set('page', '1');
    sp.set('limit', String(limit));
    setSearchParams(sp, { replace: true });
  }

  function reasonChips(reason?: string) {
    const raw = (reason ?? '').trim();
    if (!raw) return [];
    return raw.split('|').map((s) => s.trim()).filter(Boolean).slice(0, 4);
  }

  function suspectedIssue(it: KycAttemptQueueItem) {
    const r = it.autoDecisionReason ?? '';
    if (r.includes('underage_signal')) return { label: 'Underage signal', variant: 'destructive' as const };
    if (r.includes('dob_mismatch')) return { label: 'DOB mismatch', variant: 'warning' as const };
    if (r.includes('low_confidence')) return { label: 'Low confidence', variant: 'warning' as const };
    if (r.includes('dob_unparsed')) return { label: 'DOB parse failure', variant: 'warning' as const };
    return { label: 'Needs review', variant: 'default' as const };
  }

  function fmtDate(iso: string) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  }

  const data = queueQuery.data;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={status === 'pending' ? 'default' : 'secondary'} size="sm" onClick={() => setStatus('pending')}>
              Pending
            </Button>
            <Button variant={status === 'verified' ? 'default' : 'secondary'} size="sm" onClick={() => setStatus('verified')}>
              Verified
            </Button>
            <Button variant={status === 'rejected' ? 'default' : 'secondary'} size="sm" onClick={() => setStatus('rejected')}>
              Rejected
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => queueQuery.refetch()} disabled={queueQuery.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${queueQuery.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setSearchParams(new URLSearchParams({ status: 'pending', sort: 'newest', page: '1', limit: String(limit) }), { replace: true })}>
              Reset
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="grid gap-1">
            <div className="text-xs text-muted-foreground">Sort</div>
            <Select value={sort} onValueChange={(v) => setParams({ sort: v }, { resetPage: true })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <div className="text-xs text-muted-foreground">Issue (reason token)</div>
            <Select value={reasonToken ?? 'ALL'} onValueChange={(v) => setParams({ reasonToken: v === 'ALL' ? undefined : v }, { resetPage: true })}>
              <SelectTrigger>
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All</SelectItem>
                <SelectItem value="low_confidence">low_confidence</SelectItem>
                <SelectItem value="dob_mismatch">dob_mismatch</SelectItem>
                <SelectItem value="client_underage_signal">client_underage_signal</SelectItem>
                <SelectItem value="server_underage_signal">server_underage_signal</SelectItem>
                <SelectItem value="client_dob_unparsed">client_dob_unparsed</SelectItem>
                <SelectItem value="server_dob_unparsed">server_dob_unparsed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1">
            <div className="text-xs text-muted-foreground">Min client confidence</div>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              defaultValue={minClientConfidenceStr}
              placeholder="e.g. 0.70"
              onBlur={(e) => {
                const v = (e.currentTarget.value ?? '').trim();
                setParams({ minClientConfidence: v || undefined }, { resetPage: true });
              }}
            />
          </div>

          <div className="grid gap-1">
            <div className="text-xs text-muted-foreground">Min server confidence</div>
            <Input
              type="number"
              min={0}
              max={1}
              step={0.01}
              defaultValue={minServerConfidenceStr}
              placeholder="e.g. 0.70"
              onBlur={(e) => {
                const v = (e.currentTarget.value ?? '').trim();
                setParams({ minServerConfidence: v || undefined }, { resetPage: true });
              }}
            />
          </div>

          <div className="grid gap-1">
            <div className="text-xs text-muted-foreground">Submitted from (YYYY-MM-DD)</div>
            <Input
              type="date"
              value={submittedFrom ?? ''}
              onChange={(e) => setParams({ submittedFrom: e.currentTarget.value || undefined, tz: 'Asia/Kathmandu' }, { resetPage: true })}
            />
          </div>

          <div className="grid gap-1">
            <div className="text-xs text-muted-foreground">Submitted to (YYYY-MM-DD)</div>
            <Input
              type="date"
              value={submittedTo ?? ''}
              onChange={(e) => setParams({ submittedTo: e.currentTarget.value || undefined, tz: 'Asia/Kathmandu' }, { resetPage: true })}
            />
          </div>

          <div className="grid gap-1">
            <div className="text-xs text-muted-foreground">Page size</div>
            <Select value={String(limit)} onValueChange={(v) => setParams({ limit: v }, { resetPage: true })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="20">20</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>

        </div>

        <div className="mt-3">
          <SavedFiltersBar
            moduleKey="kyc-queue"
            currentParams={searchParams}
            paginationKeys={['page']}
            onApply={(params) => setSearchParams(params, { replace: false })}
          />
        </div>
      </Card>

      {queueQuery.isError ? <ErrorState error={normalizeApiError(queueQuery.error)} onRetry={() => queueQuery.refetch()} /> : null}

      <Card className="overflow-hidden">
        <div className="border-b px-4 py-3 text-sm font-semibold">KYC queue</div>
        <div className="max-h-[72vh] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Auto</th>
                <th className="px-4 py-3 font-medium">Conf (C/S)</th>
                <th className="px-4 py-3 font-medium">Age</th>
                <th className="px-4 py-3 font-medium">Issue</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {queueQuery.isLoading ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={8}>
                    Loading…
                  </td>
                </tr>
              ) : null}

              {!queueQuery.isLoading && data?.items?.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted-foreground" colSpan={8}>
                    No items found.
                  </td>
                </tr>
              ) : null}

              {data?.items?.map((it) => {
                const issue = suspectedIssue(it);
                return (
                  <tr key={it._id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{it.userId?.name ?? it.userId?.email ?? 'Unknown user'}</div>
                      <div className="text-xs text-muted-foreground">{it.userId?.email ?? it.userId?.phone ?? '—'}</div>
                    </td>
                    <td className="px-4 py-3">{fmtDate(it.submittedAt)}</td>
                    <td className="px-4 py-3">
                      <Badge>{it.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={it.autoDecision === 'auto_verified' ? 'success' : 'warning'}>{it.autoDecision}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted-foreground">
                        {(it.clientConfidence ?? 0).toFixed(2)} / {(it.serverConfidence ?? 0).toFixed(2)}
                      </div>
                      <div className="text-xs text-muted-foreground">ΔDOB: {it.dobDifferenceDays ?? '—'}d</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs text-muted-foreground">
                        {typeof it.ageYears === 'number' ? it.ageYears : '—'} / {it.legalAgeMin ?? '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={issue.variant}>{issue.label}</Badge>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {reasonChips(it.autoDecisionReason).map((c) => (
                          <span key={c} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button asChild size="sm" variant="secondary">
                        <Link to={`/kyc/${it.userId?._id ?? it.userId}`} title="Review latest attempt for user">
                          Review
                        </Link>
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted-foreground">
          <div>{data ? `Page ${data.page} · ${data.total} total` : '—'}</div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1 || queueQuery.isLoading} onClick={() => setParams({ page: String(page - 1) })}>
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={queueQuery.isLoading || !data || data.page * data.limit >= data.total}
              onClick={() => setParams({ page: String(page + 1) })}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
